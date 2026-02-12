import type { Context } from 'telegraf';
import { Address } from 'znn-typescript-sdk';
import { CONFIG, type FuseTier } from '../config/index.js';
import { fuseToAddress } from '../services/plasma.js';
import { getQsrBalance, tryReserveQsr, releaseQsr } from '../services/balance.js';
import { getNextUnfuseTime } from '../services/unfuse.js';
import { getWalletAddress } from '../services/wallet.js';
import { checkAddressAvailability } from '../middleware/rateLimiter.js';
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

  // Check per-address availability
  const addressCheck = await checkAddressAvailability(addressStr);
  if (!addressCheck.allowed) {
    await reply(ctx, formatError(addressCheck.reason!));
    return;
  }

  // Create audit record
  const fuseRequest = await FuseRequest.create({
    beneficiary: addressStr,
    tier,
    ipAddress: 'telegram',
    source: 'telegram',
    telegramUserId,
    status: 'processing',
  });

  const balance = await getQsrBalance();

  // Atomic check + reserve
  if (!tryReserveQsr(amount, balance)) {
    fuseRequest.status = 'failed';
    fuseRequest.errorMessage = 'Insufficient QSR balance for this tier';
    await fuseRequest.save();

    const available = Math.max(0, balance);
    const nextUnfuse = await getNextUnfuseTime();
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
    await fuseRequest.save();

    await reply(ctx, formatError('Failed to fuse plasma. Please try again later.'));
  } finally {
    releaseQsr(amount);
  }
}
