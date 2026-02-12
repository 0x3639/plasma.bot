import { FuseRequest } from '../models/FuseRequest.js';
import { CONFIG } from '../config/index.js';

/**
 * Check if a Telegram user has exceeded their daily fuse limit.
 * Counts FuseRequest docs with source='telegram' and matching telegramUserId
 * in the last 24 hours.
 */
export async function checkTelegramUserRateLimit(
  telegramUserId: number,
): Promise<{ allowed: boolean; remaining: number }> {
  const max = CONFIG.TELEGRAM_RATE_LIMIT_PER_USER_MAX;
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const count = await FuseRequest.countDocuments({
    source: 'telegram',
    telegramUserId,
    createdAt: { $gte: since },
  });

  return {
    allowed: count < max,
    remaining: Math.max(0, max - count),
  };
}
