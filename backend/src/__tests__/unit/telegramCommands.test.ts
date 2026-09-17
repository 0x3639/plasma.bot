import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { Address } from 'znn-typescript-sdk';
import { Fusion } from '../../models/Fusion.js';
import { FuseRequest } from '../../models/FuseRequest.js';
import {
  handleFuseCommand,
  MAX_IN_FLIGHT_COMMANDS,
  MAX_IN_FLIGHT_REJECTION_REPLIES,
  _getInFlightForTesting,
  _resetForTesting as _resetCommandsForTesting,
} from '../../telegram/commands.js';
import { getReservedQsr, tryReserveQsr, _resetForTesting } from '../../services/balance.js';
import { logger } from '../../utils/logger.js';
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
    _resetCommandsForTesting();
    let txSeq = 0;
    mockSend.mockImplementation(async () => ({ hash: { toString: () => `tg-tx-${++txSeq}` } }));
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
    it('rejects a burst from one user up front: one command in flight per user', async () => {
      const userId = 777;
      const ctxs = Array.from({ length: 6 }, () => makeCtx(`/fuse 20 ${randomAddress()}`, userId));

      await Promise.all(ctxs.map(run));

      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(await FuseRequest.countDocuments({ telegramUserId: userId })).toBe(1);
      // Five were rejected; one rejection reply is sent per user, the rest
      // are coalesced (dropped) so a burst cannot amplify into replies.
      const rejected = ctxs.filter((c) => lastReply(c).includes('already have a command in progress'));
      expect(rejected).toHaveLength(1);
      expect(_getInFlightForTesting()).toMatchObject({ commands: 0, users: 0, rejectionReplies: 0, droppedRejections: 4 });
    });

    it('bounds total in-flight commands and rejects the rest without doing any work', async () => {
      // Hold every handler at the balance read so they stay in flight.
      let releaseBalance!: () => void;
      const gate = new Promise<void>((resolve) => { releaseBalance = resolve; });
      mockGetAccountInfo.mockImplementation(async () => { await gate; return createMockAccountInfo(10_000); });

      const inFlight = Array.from({ length: MAX_IN_FLIGHT_COMMANDS }, (_, i) =>
        makeCtx(`/fuse 20 ${randomAddress()}`, 10_000 + i));
      const running = inFlight.map(run);
      // Let them all reach the gate.
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(_getInFlightForTesting().commands).toBe(MAX_IN_FLIGHT_COMMANDS);

      const extra = makeCtx(`/fuse 20 ${randomAddress()}`, 99_999);
      await run(extra);
      expect(lastReply(extra)).toContain('busy');
      expect(await FuseRequest.countDocuments({ telegramUserId: 99_999 })).toBe(0);

      releaseBalance();
      await Promise.all(running);
      expect(_getInFlightForTesting()).toMatchObject({ commands: 0, users: 0 });
      expect(mockSend).toHaveBeenCalledTimes(MAX_IN_FLIGHT_COMMANDS);
    });

    it('a flood of never-settling rejection replies is bounded and coalesced', async () => {
      // Fill every command slot with distinct users whose handlers are held
      // at the balance read.
      let releaseBalance!: () => void;
      const gate = new Promise<void>((resolve) => { releaseBalance = resolve; });
      mockGetAccountInfo.mockImplementation(async () => { await gate; return createMockAccountInfo(10_000); });
      const holders = Array.from({ length: MAX_IN_FLIGHT_COMMANDS }, (_, i) =>
        makeCtx(`/fuse 20 ${randomAddress()}`, 20_000 + i));
      const running = holders.map(run);
      await new Promise((resolve) => setTimeout(resolve, 200));

      // 40 more updates from 40 distinct users whose rejection replies do not
      // settle (Telegram never answers) for the whole assertion window, plus
      // 10 repeats from one of them.
      const pendingReplies: Array<() => void> = [];
      const hang = () => new Promise<void>((resolve) => { pendingReplies.push(resolve); });
      const flood = Array.from({ length: 40 }, (_, i) => {
        const c = makeCtx(`/fuse 20 ${randomAddress()}`, 30_000 + i);
        c.reply.mockImplementation(hang);
        return c;
      });
      const repeats = Array.from({ length: 10 }, () => {
        const c = makeCtx(`/fuse 20 ${randomAddress()}`, 30_000);
        c.reply.mockImplementation(hang);
        return c;
      });
      const floodRuns = [...flood, ...repeats].map(run);
      await new Promise((resolve) => setTimeout(resolve, 50));

      const snap = _getInFlightForTesting();
      expect(snap.commands).toBe(MAX_IN_FLIGHT_COMMANDS);
      expect(snap.rejectionReplies).toBe(MAX_IN_FLIGHT_REJECTION_REPLIES);
      // Everything beyond the reply bound (and every repeat) was dropped
      // without starting a network operation.
      const repliesStarted = [...flood, ...repeats].filter((c) => c.reply.mock.calls.length > 0).length;
      expect(repliesStarted).toBe(MAX_IN_FLIGHT_REJECTION_REPLIES);
      expect(snap.droppedRejections).toBe(50 - MAX_IN_FLIGHT_REJECTION_REPLIES);
      // No pre-admission work happened for any rejected update.
      expect(await FuseRequest.countDocuments({ telegramUserId: { $gte: 30_000 } })).toBe(0);

      releaseBalance();
      await Promise.all(running);
      expect(_getInFlightForTesting().commands).toBe(0);

      // Telegram finally answers: the bounded replies drain and the bound resets.
      pendingReplies.forEach((resolve) => resolve());
      await Promise.all(floodRuns);
      expect(_getInFlightForTesting().rejectionReplies).toBe(0);
    });

    it('one user gets at most one pending rejection reply', async () => {
      let releaseBalance!: () => void;
      const gate = new Promise<void>((resolve) => { releaseBalance = resolve; });
      mockGetAccountInfo.mockImplementation(async () => { await gate; return createMockAccountInfo(10_000); });
      const holder = makeCtx(`/fuse 20 ${randomAddress()}`, 555);
      const holding = run(holder);
      await new Promise((resolve) => setTimeout(resolve, 50));

      const pendingReplies: Array<() => void> = [];
      const hang = () => new Promise<void>((resolve) => { pendingReplies.push(resolve); });
      const dupes = Array.from({ length: 5 }, () => {
        const c = makeCtx(`/fuse 20 ${randomAddress()}`, 555);
        c.reply.mockImplementation(hang);
        return c;
      });
      const dupeRuns = dupes.map(run);
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(dupes.filter((c) => c.reply.mock.calls.length > 0)).toHaveLength(1);
      expect(_getInFlightForTesting().rejectionReplies).toBe(1);

      releaseBalance();
      await holding;
      pendingReplies.forEach((resolve) => resolve());
      await Promise.all(dupeRuns);
      expect(_getInFlightForTesting().rejectionReplies).toBe(0);
    });

    it('fast-failing rejection replies do not amplify into log lines', async () => {
      let releaseBalance!: () => void;
      const gate = new Promise<void>((resolve) => { releaseBalance = resolve; });
      mockGetAccountInfo.mockImplementation(async () => { await gate; return createMockAccountInfo(10_000); });
      const holders = Array.from({ length: MAX_IN_FLIGHT_COMMANDS }, (_, i) =>
        makeCtx(`/fuse 20 ${randomAddress()}`, 40_000 + i));
      const running = holders.map(run);
      await new Promise((resolve) => setTimeout(resolve, 200));

      const warn = vi.spyOn(logger, 'warn');
      // 60 distinct users; every rejection reply fails immediately (Telegram
      // 429), which releases its permit at once, so all 60 replies are sent.
      const flood = Array.from({ length: 60 }, (_, i) => {
        const c = makeCtx(`/fuse 20 ${randomAddress()}`, 50_000 + i);
        c.reply.mockRejectedValue(new Error('429: Too Many Requests'));
        return c;
      });
      for (const c of flood) await run(c);

      const replyFailureLogs = warn.mock.calls.filter((call) => String(call[0]) === 'Telegram reply failed');
      const rejectionLogs = warn.mock.calls.filter((call) => String(call[0]) === 'Telegram command rejected');
      expect(replyFailureLogs).toHaveLength(1);
      expect(rejectionLogs).toHaveLength(1);
      expect(flood.every((c) => c.reply.mock.calls.length === 1)).toBe(true);
      warn.mockRestore();

      releaseBalance();
      await Promise.all(running);
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
