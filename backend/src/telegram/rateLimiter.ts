import { FuseRequest, type IFuseRequest } from '../models/FuseRequest.js';
import { CONFIG } from '../config/index.js';
import { logger } from '../utils/logger.js';

/**
 * Requests a Telegram user has made in the rolling 24h window.
 *
 * Every terminal status counts — a failed fuse still consumed an attempt — with
 * one exception: 'rate_limited' records are the rollback state written by
 * confirmTelegramUserSlot for requests that lost a concurrent burst. They never
 * dispensed anything, and excluding them keeps a burst from also burning the
 * user's remaining quota.
 */
async function countUserRequests(telegramUserId: number): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return FuseRequest.countDocuments({
    source: 'telegram',
    telegramUserId,
    status: { $ne: 'rate_limited' },
    createdAt: { $gte: since },
  });
}

/**
 * Pre-check used before doing any work. Read-only and therefore racy under a
 * concurrent burst from one user; confirmTelegramUserSlot closes that race.
 */
export async function checkTelegramUserRateLimit(
  telegramUserId: number,
): Promise<{ allowed: boolean; remaining: number }> {
  const max = CONFIG.TELEGRAM_RATE_LIMIT_PER_USER_MAX;
  const count = await countUserRequests(telegramUserId);

  return {
    allowed: count < max,
    remaining: Math.max(0, max - count),
  };
}

/**
 * Atomic per-user quota enforcement, called AFTER the 'processing' FuseRequest
 * is created.
 *
 * Telegraf handles a polling batch concurrently, and the per-address unique
 * index cannot serialize one user's requests for distinct addresses, so N
 * concurrent commands can all pass the read-only pre-check. Re-counting after
 * our own insert closes that race: each request's count includes its own
 * record plus every record committed before it, so at most `max` requests can
 * observe count <= max. Losers are rolled back to 'rate_limited' (which frees
 * their address lock and global-cap slot, and is excluded from the user count)
 * and rejected.
 *
 * Returns true if the request holds a valid per-user slot. Throws on DB errors
 * (callers fail closed).
 */
export async function confirmTelegramUserSlot(fuseRequest: IFuseRequest): Promise<boolean> {
  const max = CONFIG.TELEGRAM_RATE_LIMIT_PER_USER_MAX;
  if (fuseRequest.telegramUserId === null) {
    throw new Error('confirmTelegramUserSlot requires a telegramUserId');
  }
  const count = await countUserRequests(fuseRequest.telegramUserId);

  if (count > max) {
    fuseRequest.status = 'rate_limited';
    fuseRequest.errorMessage = 'Per-user daily limit reached (concurrent burst)';
    await fuseRequest.save();
    logger.warn('Telegram per-user limit hit (post-create check)', {
      telegramUserId: fuseRequest.telegramUserId,
      count,
      max,
    });
    return false;
  }

  return true;
}
