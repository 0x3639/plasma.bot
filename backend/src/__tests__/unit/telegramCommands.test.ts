import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { Address } from 'znn-typescript-sdk';
import { Fusion } from '../../models/Fusion.js';
import { FuseRequest } from '../../models/FuseRequest.js';
import { handleFuseCommand } from '../../telegram/commands.js';
import { getReservedQsr, tryReserveQsr, _resetForTesting } from '../../services/balance.js';
import { createMockAccountInfo, createMockAddress } from '../setup/mocks.js';

const mockSend = vi.fn();
const mockFuse = vi.fn().mockReturnValue({ blockType: 4 });
const mockGetAccountInfo = vi.fn();
const mockGetEntriesByAddress = vi.fn().mockResolvedValue({ list: [] });

vi.mock('../../config/index.js', async () => {
  const actual = await vi.importActual('../../config/index.js') as Record<string, unknown>;
  return {
    ...actual,
    CONFIG: {
      ...(actual.CONFIG as Record<string, unknown>),
      TELEGRAM_RATE_LIMIT_PER_USER_MAX: 4,
      TELEGRAM_GLOBAL_DAILY_MAX: 100,
    },
  };
});

vi.mock('../../services/zenon.js', () => ({
  getZenon: () => ({
    ledger: {
      getAccountInfoByAddress: mockGetAccountInfo,
      getFrontierMomentum: vi.fn().mockResolvedValue({ height: 1000000 }),
    },
    embedded: {
      plasma: {
        fuse: mockFuse,
        getEntriesByAddress: mockGetEntriesByAddress,
      },
    },
    send: mockSend,
  }),
}));

vi.mock('../../services/wallet.js', () => ({
  getKeyPair: () => ({ getAddress: () => createMockAddress() }),
  getWalletAddress: () => createMockAddress(),
}));

vi.mock('../../services/sendQueue.js', async () => {
  const actual = await vi.importActual('../../services/sendQueue.js') as Record<string, unknown>;
  return {
    ...actual,
    serializedSend: async (block: unknown, keyPair: unknown, options: { beforeSend?: () => Promise<void> } = {}) => {
      if (options.beforeSend) await options.beforeSend();
      return mockSend(block, keyPair);
    },
  };
});

// Keep the real Address (canonicalization is what we test) but pin QSR_ZTS to
// the token standard used by createMockAccountInfo.
vi.mock('znn-typescript-sdk', async () => {
  const actual = await vi.importActual('znn-typescript-sdk') as Record<string, unknown>;
  return {
    ...actual,
    QSR_ZTS: { toString: () => 'zts1qsrxxxxxxxxxxxxxmerced' },
  };
});

/** A valid, random, canonical (lowercase) Zenon user address. */
function randomAddress(): string {
  return Address.fromCore(Buffer.concat([Buffer.from([0]), randomBytes(19)])).toString();
}

interface FakeCtx {
  from: { id: number };
  chat: { id: number; type: string };
  message: { text: string };
  update: { update_id: number };
  reply: ReturnType<typeof vi.fn>;
}

function makeCtx(text: string, userId = 4242): FakeCtx {
  return {
    from: { id: userId },
    chat: { id: userId, type: 'private' },
    message: { text },
    update: { update_id: Math.floor(Math.random() * 1e6) },
    reply: vi.fn().mockResolvedValue({ message_id: 1 }),
  };
}

function run(ctx: FakeCtx): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return handleFuseCommand(ctx as any);
}

function lastReply(ctx: FakeCtx): string {
  const calls = ctx.reply.mock.calls;
  return String(calls[calls.length - 1]?.[0] ?? '');
}

describe('Telegram /fuse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetForTesting();
    mockSend.mockResolvedValue({ hash: { toString: () => 'tg-tx-hash' } });
    mockGetAccountInfo.mockResolvedValue(createMockAccountInfo(10_000));
    mockGetEntriesByAddress.mockResolvedValue({ list: [] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('address canonicalization (uppercase alias)', () => {
    it('rejects the uppercase form of an address that already has an active fusion', async () => {
      const addr = randomAddress();
      await Fusion.create({
        beneficiary: addr,
        tier: 'low',
        qsrAmount: 2000000000,
        txHash: 'tx-existing',
        status: 'active',
        fusedAt: new Date(),
      });

      const ctx = makeCtx(`/fuse 20 ${addr.toUpperCase()}`);
      await run(ctx);

      expect(mockSend).not.toHaveBeenCalled();
      expect(lastReply(ctx)).toContain('already has an active plasma fusion');
      expect(await FuseRequest.countDocuments({})).toBe(0);
    });

    it('rejects the uppercase form while the lowercase form is being processed', async () => {
      const addr = randomAddress();
      await FuseRequest.create({
        beneficiary: addr,
        tier: 'low',
        ipAddress: 'telegram',
        source: 'telegram',
        telegramUserId: 1,
        status: 'processing',
      });

      const ctx = makeCtx(`/fuse 20 ${addr.toUpperCase()}`);
      await run(ctx);

      expect(mockSend).not.toHaveBeenCalled();
      expect(lastReply(ctx)).toContain('already being processed');
    });

    it('rejects the uppercase form when only the chain knows about the fusion', async () => {
      const addr = randomAddress();
      mockGetEntriesByAddress.mockResolvedValue({
        list: [{
          id: { toString: () => 'chain-id' },
          beneficiary: { toString: () => addr },
          qsrAmount: { toString: () => '2000000000' },
          expirationHeight: 1,
        }],
      });

      const ctx = makeCtx(`/fuse 20 ${addr.toUpperCase()}`);
      await run(ctx);

      expect(mockSend).not.toHaveBeenCalled();
      expect(lastReply(ctx)).toContain('already has an active plasma fusion');
    });

    it('stores the canonical lowercase beneficiary for an uppercase request', async () => {
      const addr = randomAddress();
      const ctx = makeCtx(`/fuse 20 ${addr.toUpperCase()}`);
      await run(ctx);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const req = await FuseRequest.findOne({});
      expect(req?.beneficiary).toBe(addr);
      expect(req?.status).toBe('completed');
      const fusion = await Fusion.findOne({});
      expect(fusion?.beneficiary).toBe(addr);
      // The signed block targets the same canonical address.
      const fusedTo = mockFuse.mock.calls[0][0] as Address;
      expect(fusedTo.toString()).toBe(addr);
      expect(lastReply(ctx)).toContain(addr);
    });

    it('rejects a mixed-case address', async () => {
      const addr = randomAddress();
      const mixed = addr.slice(0, 10) + addr.slice(10).toUpperCase();
      const ctx = makeCtx(`/fuse 20 ${mixed}`);
      await run(ctx);
      expect(mockSend).not.toHaveBeenCalled();
      expect(lastReply(ctx)).toContain('Invalid Zenon address');
    });
  });

  describe('per-user quota under a concurrent burst', () => {
    it('admits at most the per-user max from one batch of distinct addresses', async () => {
      const userId = 777;
      const ctxs = Array.from({ length: 6 }, () => makeCtx(`/fuse 20 ${randomAddress()}`, userId));

      await Promise.all(ctxs.map(run));

      // Count-after-insert guarantees at most `max` admissions. It can
      // under-admit when several inserts land before any recount (the same
      // property as the global cap), so the bound is the invariant here.
      const sends = mockSend.mock.calls.length;
      expect(sends).toBeLessThanOrEqual(4);
      const completed = await FuseRequest.countDocuments({ telegramUserId: userId, status: 'completed' });
      const rateLimited = await FuseRequest.countDocuments({ telegramUserId: userId, status: 'rate_limited' });
      expect(completed).toBe(sends);
      expect(completed + rateLimited).toBe(6);
      expect(await FuseRequest.countDocuments({ status: 'processing' })).toBe(0);

      const rejected = ctxs.filter((c) => lastReply(c).toLowerCase().includes('limit'));
      expect(rejected).toHaveLength(rateLimited);
    });

    it('sequential requests admit exactly the per-user max', async () => {
      const userId = 780;
      for (let i = 0; i < 5; i++) {
        await run(makeCtx(`/fuse 20 ${randomAddress()}`, userId));
      }
      expect(mockSend).toHaveBeenCalledTimes(4);
      expect(await FuseRequest.countDocuments({ telegramUserId: userId, status: 'completed' })).toBe(4);
      // The 5th is refused by the pre-check and never creates a record.
      expect(await FuseRequest.countDocuments({ telegramUserId: userId })).toBe(4);
    });

    it('a rate-limited rollback frees its address and global slot', async () => {
      const userId = 778;
      // Pre-load the user to the cap.
      for (let i = 0; i < 4; i++) {
        await FuseRequest.create({
          beneficiary: randomAddress(), tier: 'low', ipAddress: 'telegram',
          source: 'telegram', telegramUserId: userId, status: 'completed',
        });
      }
      const addr = randomAddress();
      const ctx = makeCtx(`/fuse 20 ${addr}`, userId);
      await run(ctx);

      expect(mockSend).not.toHaveBeenCalled();
      expect(await FuseRequest.countDocuments({ beneficiary: addr, status: 'processing' })).toBe(0);
      // A different user can now fuse to that address.
      const other = makeCtx(`/fuse 20 ${addr}`, 779);
      await run(other);
      expect(mockSend).toHaveBeenCalledTimes(1);
    });
  });

  describe('notification failures', () => {
    it('never rejects when every reply fails', async () => {
      const blocked = new Error('403: Forbidden: bot was blocked by the user');

      const invalid = makeCtx('/fuse 20 not-an-address');
      invalid.reply.mockRejectedValue(blocked);
      await expect(run(invalid)).resolves.toBeUndefined();

      const help = makeCtx('/fuse');
      help.reply.mockRejectedValue(blocked);
      await expect(run(help)).resolves.toBeUndefined();

      const ok = makeCtx(`/fuse 20 ${randomAddress()}`);
      ok.reply.mockRejectedValue(blocked);
      await expect(run(ok)).resolves.toBeUndefined();
    });

    it('a failed success reply leaves the request completed and releases the reservation once', async () => {
      vi.useFakeTimers();
      const other = tryReserveQsr(20, 10_000)!; // another request's live reservation
      const addr = randomAddress();
      const ctx = makeCtx(`/fuse 20 ${addr}`);
      ctx.reply.mockRejectedValue(new Error('403: Forbidden: bot was blocked by the user'));

      await run(ctx);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const req = await FuseRequest.findOne({ beneficiary: addr });
      expect(req?.status).toBe('completed');
      expect(req?.errorMessage).toBeNull();

      // 20 (other) + 20 (this) held, then only this one released.
      expect(getReservedQsr()).toBe(40);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(getReservedQsr()).toBe(20);
      expect(other.settled).toBe(false);
    });

    it('an unexpected handler error is contained and reported', async () => {
      mockGetAccountInfo.mockRejectedValue(new Error('socket not ready'));
      const ctx = makeCtx(`/fuse 20 ${randomAddress()}`);
      await expect(run(ctx)).resolves.toBeUndefined();
      expect(lastReply(ctx)).toContain('temporarily unavailable');
      expect(await FuseRequest.countDocuments({ status: 'processing' })).toBe(0);
    });
  });

  it('status accepts an uppercase address and reports the canonical one', async () => {
    const addr = randomAddress();
    await Fusion.create({
      beneficiary: addr, tier: 'low', qsrAmount: 2000000000,
      txHash: 'tx-1', status: 'active', fusedAt: new Date(),
    });
    const ctx = makeCtx(`/fuse status ${addr.toUpperCase()}`);
    await run(ctx);
    expect(lastReply(ctx)).toContain(addr);
    expect(lastReply(ctx)).not.toContain('No active fusions');
  });
});
