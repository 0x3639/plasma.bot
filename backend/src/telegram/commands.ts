import type { Context } from 'telegraf';
import { Address } from 'znn-typescript-sdk';
import { CONFIG, type FuseTier } from '../config/index.js';
import { fuseToAddress } from '../services/plasma.js';
import { getQsrBalance, tryReserveQsr, scheduleReleaseQsr } from '../services/balance.js';
import { getNextUnfuseTime } from '../services/unfuse.js';
import { getWalletAddress } from '../services/wallet.js';
import { checkAddressAvailability, isGlobalDailyCapReached, confirmGlobalCapSlot } from '../middleware/rateLimiter.js';
import { checkTelegramUserRateLimit } from './rateLimiter.js';
import { Fusion } from '../models/Fusion.js';
import { FuseRequest } from '../models/FuseRequest.js';
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

function reply(ctx: Context, text: string): Promise<unknown> {
  return ctx.reply(text, { parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
}

/**
 * Handle the /fuse command with all subcommands.
 */
export async function handleFuseCommand(ctx: Context): Promise<void> {
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

async function handleStatus(ctx: Context, address?: string): Promise<void> {
  try {
    if (address) {
      // Validate address format
      try {
        Address.parse(address);
      } catch {
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

async function handleFuse(
  ctx: Context,
  tier: FuseTier,
  amount: number,
  addressStr: string,
): Promise<void> {
  const telegramUserId = ctx.from?.id;
  if (!telegramUserId) {
    await reply(ctx, formatError('Could not identify your Telegram user.'));
    return;
  }

  // Validate address
  try {
    Address.parse(addressStr);
  } catch {
    await reply(ctx, formatError('Invalid Zenon address.'));
    return;
  }

  // Check per-user rate limit
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
  const addressCheck = await checkAddressAvailability(addressStr);
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
      beneficiary: addressStr,
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
    logger.error('Failed to create telegram fuse request record', { error, address: addressStr });
    await reply(ctx, formatError('Service temporarily unavailable. Please try again later.'));
    return;
  }

  // From here on, every exit path must move the record off 'processing' — a
  // stuck 'processing' record blocks this address (unique partial index +
  // availability check) and occupies a global-cap slot until the stale-request
  // sweeper clears it.
  let balance: number;
  try {
    // Atomic re-check of the global cap now that our 'processing' record
    // exists; the pre-check above is racy under a concurrent burst.
    if (!(await confirmGlobalCapSlot(fuseRequest))) {
      await reply(ctx, formatError('The fuse service has reached its daily limit. Please try again later.'));
      return;
    }

    balance = await getQsrBalance();
  } catch (error) {
    logger.error('Telegram fuse pre-checks failed', { error, address: addressStr });
    fuseRequest.status = 'failed';
    fuseRequest.errorMessage = 'Pre-check failed (node or DB unavailable)';
    await fuseRequest.save().catch(() => undefined); // sweeper cleans up if this also fails
    await reply(ctx, formatError('Service temporarily unavailable. Please try again later.'));
    return;
  }

  // Atomic check + reserve
  if (!tryReserveQsr(amount, balance)) {
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

  try {
    const fusion = await fuseToAddress(addressStr, tier);

    fuseRequest.status = 'completed';
    fuseRequest.fusion = fusion._id;
    await fuseRequest.save();

    // Hold the reservation across the chain-confirmation window, then release.
    scheduleReleaseQsr(amount);

    logger.info('Telegram fuse completed', {
      telegramUserId,
      address: addressStr,
      tier,
      txHash: fusion.txHash,
    });

    await reply(ctx, formatFuseSuccess(addressStr, tier, amount, fusion.txHash));
  } catch (error) {
    logger.error('Telegram fuse failed', { error, telegramUserId, address: addressStr, tier });

    fuseRequest.status = 'failed';
    fuseRequest.errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await fuseRequest.save().catch(() => undefined);

    // A send "failure" can be a timeout on a block that still lands in a
    // momentum seconds later, so hold the reservation across the confirmation
    // window instead of releasing it against a stale balance.
    scheduleReleaseQsr(amount);

    await reply(ctx, formatError('Failed to fuse plasma. Please try again later.'));
  }
}
