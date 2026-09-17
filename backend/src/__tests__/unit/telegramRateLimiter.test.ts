import { describe, it, expect, vi } from 'vitest';
import { FuseRequest } from '../../models/FuseRequest.js';
import { checkTelegramUserRateLimit, confirmTelegramUserSlot } from '../../telegram/rateLimiter.js';

vi.mock('../../config/index.js', async () => {
  const actual = await vi.importActual('../../config/index.js') as Record<string, unknown>;
  return {
    ...actual,
    CONFIG: { ...(actual.CONFIG as Record<string, unknown>), TELEGRAM_RATE_LIMIT_PER_USER_MAX: 4 },
  };
});

function record(userId: number, status = 'processing', i = 0) {
  return FuseRequest.create({
    beneficiary: `z1user${userId}addr${i}`,
    tier: 'low',
    ipAddress: 'telegram',
    source: 'telegram',
    telegramUserId: userId,
    status,
  });
}

describe('confirmTelegramUserSlot (post-create atomic per-user quota)', () => {
  it('admits at most max out of a concurrent burst of distinct addresses', async () => {
    const userId = 1;
    // Simulate Telegraf's concurrent batch: all records are inserted (the
    // pre-check passed for every one), then each confirms.
    const records = await Promise.all(Array.from({ length: 7 }, (_, i) => record(userId, 'processing', i)));
    const results = await Promise.all(records.map((r) => confirmTelegramUserSlot(r)));

    const admitted = results.filter(Boolean).length;
    expect(admitted).toBeLessThanOrEqual(4);
    expect(await FuseRequest.countDocuments({ telegramUserId: userId, status: 'processing' })).toBe(admitted);
    expect(await FuseRequest.countDocuments({ telegramUserId: userId, status: 'rate_limited' })).toBe(7 - admitted);
  });

  it('admits exactly max when confirmations are sequential', async () => {
    const userId = 2;
    let admitted = 0;
    for (let i = 0; i < 6; i++) {
      const r = await record(userId, 'processing', i);
      if (await confirmTelegramUserSlot(r)) admitted++;
    }
    expect(admitted).toBe(4);
  });

  it('rate_limited rollbacks do not count against the user, other statuses do', async () => {
    const userId = 3;
    await record(userId, 'completed', 0);
    await record(userId, 'failed', 1);
    await record(userId, 'rate_limited', 2);
    await record(userId, 'rate_limited', 3);

    const limit = await checkTelegramUserRateLimit(userId);
    expect(limit.allowed).toBe(true);
    expect(limit.remaining).toBe(2);
  });

  it('requires a telegramUserId', async () => {
    const r = await FuseRequest.create({
      beneficiary: 'z1webaddr', tier: 'low', ipAddress: '1.2.3.4', source: 'web', status: 'processing',
    });
    await expect(confirmTelegramUserSlot(r)).rejects.toThrow(/telegramUserId/);
  });
});
