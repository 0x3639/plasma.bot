import type { Context } from 'telegraf';
import { CONFIG, type FuseTier } from '../config/index.js';
import { getQsrBalance, tryReserveQsr } from '../services/balance.js';
import { executeFuse, type FuseOutcome } from '../services/fuseExecutor.js';
import { getNextUnfuseTime } from '../services/unfuse.js';
import { getWalletAddress } from '../services/wallet.js';
import { checkAddressAvailability, isGlobalDailyCapReached, confirmGlobalCapSlot } from '../middleware/rateLimiter.js';
import { checkTelegramUserRateLimit, confirmTelegramUserSlot } from './rateLimiter.js';
import { Fusion } from '../models/Fusion.js';
import { FuseRequest } from '../models/FuseRequest.js';
import { canonicalizeAddress } from '../utils/address.js';
import { logger } from '../utils/logger.js';
import {
  formatHelp,
  formatFuseSuccess,
  formatHealth,
  formatFusionList,
  formatError,
  formatRateLimited,
} from './formatting.js';

const AMOUNT_TO_TIER: Record<number, FuseTier> = {
  20: 'low',
  80: 'medium',
  120: 'high',
};

/**
 * Best-effort notification. Telegram can refuse delivery at any time (the user
 * blocked the bot, the chat was deleted, the API is rate limiting us). A
 * failed reply must never change transaction state or escape the handler —
 * an escaped rejection reaches Telegraf's update-error path, and every reply
 * here is purely informational.
 */
function reply(ctx: Context, text: string): Promise<void> {
  return ctx
    .reply(text, { parse_mode: 'HTML', link_preview_options: { is_disabled: true } })
    .then(() => undefined)
    .catch((error: unknown) => {
      logger.warn('Telegram reply failed', {
        error,
        chatId: ctx.chat?.id,
        telegramUserId: ctx.from?.id,
      });
    });
}

/**
 * Handle the /fuse command with all subcommands.
 *
 * Never rejects: this is the error boundary for one update, so one user's
 * failure cannot take down the shared polling loop.
 */
export async function handleFuseCommand(ctx: Context): Promise<void> {
  try {
    await dispatchFuseCommand(ctx);
  } catch (error) {
    logger.error('Telegram command handler failed', {
      error,
      telegramUserId: ctx.from?.id,
      chatId: ctx.chat?.id,
    });
    await reply(ctx, formatError('Something went wrong. Please try again later.'));
  }
}

async function dispatchFuseCommand(ctx: Context): Promise<void> {
  const text = (ctx.message && 'text' in ctx.message ? ctx.message.text : '') || '';
  const args = text.replace(/^\/fuse(@\S+)?/, '').trim().split(/\s+/).filter(Boolean);

  if (args.length === 0) {
    await reply(ctx, formatHelp());
    return;
  }

  const subcommand = args[0].toLowerCase();

  if (subcommand === 'health') {
    await handleHealth(ctx);
    return;
  }

  if (subcommand === 'status') {
    await handleStatus(ctx, args[1]);
    return;
  }

  // Must be a fuse request: /fuse <amount> <address>
  const amount = parseInt(subcommand, 10);
  const tier = AMOUNT_TO_TIER[amount];

  if (!tier) {
    await reply(ctx, formatError(`Invalid amount. Use 20, 80, or 120 QSR.`));
    return;
  }

  if (!args[1]) {
    await reply(ctx, formatError(`Missing address. Usage: <code>/fuse ${amount} z1...</code>`));
    return;
  }

  await handleFuse(ctx, tier, amount, args[1]);
}

async function handleHealth(ctx: Context): Promise<void> {
  try {
    const balance = await getQsrBalance();
    const activeFusionCount = await Fusion.countDocuments({ status: 'active' });

    await reply(ctx, formatHealth({
      uptime: process.uptime(),
      walletAddress: getWalletAddress().toString(),
      qsrBalance: balance,
      activeFusionCount,
    }));
  } catch (error) {
    logger.error('Telegram health command failed', { error });
    await reply(ctx, formatError('Could not fetch health status. Try again later.'));
  }
}

async function handleStatus(ctx: Context, rawAddress?: string): Promise<void> {
  try {
    if (rawAddress) {
      // Canonical form so an uppercase encoding finds the same records.
      const address = canonicalizeAddress(rawAddress);
      if (!address) {
        await reply(ctx, formatError('Invalid Zenon address.'));
        return;
      }

      const fusions = await Fusion.find({ beneficiary: address, status: 'active' })
        .sort({ fusedAt: -1 })
        .limit(10)
        .exec();
      const total = await Fusion.countDocuments({ beneficiary: address, status: 'active' });

      await reply(ctx, formatFusionList(fusions, total, address));
    } else {
      const fusions = await Fusion.find({ status: 'active' })
        .sort({ fusedAt: -1 })
        .limit(10)
        .exec();
      const total = await Fusion.countDocuments({ status: 'active' });

      await reply(ctx, formatFusionList(fusions, total));
    }
  } catch (error) {
    logger.error('Telegram status command failed', { error });
    await reply(ctx, formatError('Could not fetch fusion status. Try again later.'));
  }
}

function describeFailure(outcome: Extract<FuseOutcome, { ok: false }>): string {
  switch (outcome.code) {
    case 'QUEUE_FULL':
      return 'The fuse service is busy right now. Please try again in a few minutes.';
    case 'LEASE_LOST':
      return 'Your request waited too long and expired before it could be sent. Please try again.';
    case 'FUSE_FAILED':
      return 'Failed to fuse plasma. Please try again later.';
  }
}

async function handleFuse(
  ctx: Context,
  tier: FuseTier,
  amount: number,
  rawAddress: string,
): Promise<void> {
  const telegramUserId = ctx.from?.id;
  if (!telegramUserId) {
    await reply(ctx, formatError('Could not identify your Telegram user.'));
    return;
  }

  // Validate and canonicalize. Bech32 accepts an all-uppercase encoding of the
  // same address; every check, lock and record below must use the canonical
  // (lowercase) form so `Z1...` cannot bypass the one-fusion-per-address rule
  // for an existing `z1...` fusion.
  const address = canonicalizeAddress(rawAddress);
  if (!address) {
    await reply(ctx, formatError('Invalid Zenon address.'));
    return;
  }

  // Check per-user rate limit (read-only pre-check; confirmed atomically below)
  const userLimit = await checkTelegramUserRateLimit(telegramUserId);
  if (!userLimit.allowed) {
    await reply(ctx, formatRateLimited(userLimit.remaining, CONFIG.TELEGRAM_RATE_LIMIT_PER_USER_MAX));
    return;
  }

  // Check the Telegram-wide daily cap. Telegram accounts are cheap, so the
  // per-user limit alone does not bound total dispensation from this source.
  try {
    if (await isGlobalDailyCapReached('telegram')) {
      await reply(ctx, formatError('The fuse service has reached its daily limit. Please try again later.'));
      return;
    }
  } catch (error) {
    // Fail safe: if we can't verify the cap, do not dispense funds.
    logger.error('Telegram global daily cap check failed', { error });
    await reply(ctx, formatError('Service temporarily unavailable. Please try again later.'));
    return;
  }

  // Check per-address availability
  const addressCheck = await checkAddressAvailability(address);
  if (!addressCheck.allowed) {
    await reply(ctx, formatError(addressCheck.reason!));
    return;
  }

  // Create audit record. Also the race lock (unique partial index on
  // FuseRequest{beneficiary, status:'processing'}): a concurrent request for
  // the same address fails here instead of double-fusing.
  let fuseRequest;
  try {
    fuseRequest = await FuseRequest.create({
      beneficiary: address,
      tier,
      ipAddress: 'telegram',
      source: 'telegram',
      telegramUserId,
      status: 'processing',
    });
  } catch (error) {
    if (error instanceof Error && (error as { code?: number }).code === 11000) {
      await reply(ctx, formatError('A fusion request for this address is already being processed.'));
      return;
    }
    logger.error('Failed to create telegram fuse request record', { error, address });
    await reply(ctx, formatError('Service temporarily unavailable. Please try again later.'));
    return;
  }

  // From here on, every exit path must move the record off 'processing' — a
  // stuck 'processing' record blocks this address (unique partial index +
  // availability check) and occupies a global-cap slot until the stale-request
  // sweeper clears it.
  let balance: number;
  try {
    // Atomic re-checks now that our 'processing' record exists; both
    // pre-checks above are read-only and racy under a concurrent burst.
    if (!(await confirmTelegramUserSlot(fuseRequest))) {
      await reply(ctx, formatRateLimited(0, CONFIG.TELEGRAM_RATE_LIMIT_PER_USER_MAX));
      return;
    }

    if (!(await confirmGlobalCapSlot(fuseRequest))) {
      await reply(ctx, formatError('The fuse service has reached its daily limit. Please try again later.'));
      return;
    }

    balance = await getQsrBalance();
  } catch (error) {
    logger.error('Telegram fuse pre-checks failed', { error, address });
    fuseRequest.status = 'failed';
    fuseRequest.errorMessage = 'Pre-check failed (node or DB unavailable)';
    await fuseRequest.save().catch(() => undefined); // sweeper cleans up if this also fails
    await reply(ctx, formatError('Service temporarily unavailable. Please try again later.'));
    return;
  }

  // Atomic check + reserve
  const reservation = tryReserveQsr(amount, balance);
  if (!reservation) {
    fuseRequest.status = 'failed';
    fuseRequest.errorMessage = 'Insufficient QSR balance for this tier';
    await fuseRequest.save();

    // Best-effort: the record is already 'failed', so a node error here must
    // not abort the reply.
    const available = Math.max(0, balance);
    const nextUnfuse = await getNextUnfuseTime().catch(() => null);
    let error = `Not enough QSR available for the ${tier} tier (${amount} QSR needed, ${available} available).`;

    if (available >= 20 && amount > 20) {
      error += ' Try selecting a lower tier.';
    } else if (nextUnfuse) {
      const hoursRemaining = Math.max(1, Math.ceil((nextUnfuse.getTime() - Date.now()) / (60 * 60 * 1000)));
      error += ` QSR will be reclaimed in ~${hoursRemaining}h. Try again later.`;
    } else {
      error += ' Try again later.';
    }

    await reply(ctx, formatError(error));
    return;
  }

  // The transaction outcome is settled (record state + reservation) before any
  // notification is attempted, so a failed reply cannot roll back a completed
  // fuse or release the reservation a second time.
  const outcome = await executeFuse(fuseRequest, tier, reservation);

  if (outcome.ok) {
    logger.info('Telegram fuse completed', {
      telegramUserId,
      address,
      tier,
      txHash: outcome.fusion.txHash,
    });
    await reply(ctx, formatFuseSuccess(address, tier, amount, outcome.fusion.txHash));
    return;
  }

  await reply(ctx, formatError(describeFailure(outcome)));
}
