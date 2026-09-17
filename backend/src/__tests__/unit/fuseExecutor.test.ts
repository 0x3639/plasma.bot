import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FuseRequest } from '../../models/FuseRequest.js';
import { Fusion } from '../../models/Fusion.js';
import { executeFuse, _resetForTesting as _resetExecutorForTesting } from '../../services/fuseExecutor.js';
import { logger } from '../../utils/logger.js';
import { tryReserveQsr, getReservedQsr, _resetForTesting } from '../../services/balance.js';
import { failStaleProcessingRequests } from '../../cron/reconcile.js';
import { SendQueueFullError } from '../../services/sendQueue.js';

const mockSend = vi.fn();
const mockFuse = vi.fn().mockReturnValue({ blockType: 4 });

vi.mock('../../services/zenon.js', () => ({
  getZenon: () => ({
    embedded: { plasma: { fuse: mockFuse, getEntriesByAddress: vi.fn().mockResolvedValue({ list: [] }) } },
    send: mockSend,
  }),
}));

vi.mock('../../services/wallet.js', () => ({
  getKeyPair: () => ({ getAddress: () => ({ toString: () => 'z1mock' }) }),
  getWalletAddress: () => ({ toString: () => 'z1mock' }),
}));

// Route the real serializedSend's zenon.send through mockSend but keep the
// beforeSend hook semantics: the mock queue runs the hook, then "sends".
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

vi.mock('znn-typescript-sdk', async () => {
  const actual = await vi.importActual('znn-typescript-sdk') as Record<string, unknown>;
  return {
    ...actual,
    Address: { parse: (addr: string) => ({ toString: () => addr }) },
  };
});

const addr = 'z1qrjdhy65zds69a96xlhheu4sy689k34x4hpse0';

async function createProcessing() {
  return FuseRequest.create({ beneficiary: addr, tier: 'low', ipAddress: '1.2.3.4', status: 'processing' });
}

describe('executeFuse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetForTesting();
    _resetExecutorForTesting();
    mockSend.mockResolvedValue({ hash: { toString: () => 'tx-ok' } });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('completes the request, creates the fusion, and holds the reservation once', async () => {
    vi.useFakeTimers();
    const req = await createProcessing();
    const other = tryReserveQsr(20, 1000)!; // another in-flight request
    const reservation = tryReserveQsr(20, 1000)!;

    const outcome = await executeFuse(req, 'low', reservation);

    expect(outcome.ok).toBe(true);
    expect(mockSend).toHaveBeenCalledTimes(1);
    const saved = await FuseRequest.findById(req._id);
    expect(saved?.status).toBe('completed');
    expect(await Fusion.countDocuments({ beneficiary: addr, status: 'pending' })).toBe(1);

    // Held across the confirmation window, then released exactly once.
    expect(getReservedQsr()).toBe(40);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(getReservedQsr()).toBe(20);
    expect(other.settled).toBe(false);
  });

  it('does not sign when the processing lease was swept while queued', async () => {
    const req = await createProcessing();
    const old = new Date(Date.now() - 11 * 60 * 1000);
    await FuseRequest.collection.updateOne({ _id: req._id }, { $set: { createdAt: old, updatedAt: old } });
    await failStaleProcessingRequests();

    const reservation = tryReserveQsr(20, 1000)!;
    const outcome = await executeFuse(req, 'low', reservation);

    expect(outcome).toEqual({ ok: false, code: 'LEASE_LOST' });
    expect(mockSend).not.toHaveBeenCalled();
    expect(await Fusion.countDocuments({})).toBe(0);
    // Nothing was sent, so the reservation is released immediately and the
    // sweeper's terminal state is left intact.
    expect(getReservedQsr()).toBe(0);
    const saved = await FuseRequest.findById(req._id);
    expect(saved?.status).toBe('failed');
    expect(saved?.errorMessage).toContain('Stale processing');
  });

  it('marks the request failed and releases immediately when the queue is full', async () => {
    mockSend.mockRejectedValueOnce(new SendQueueFullError());
    const req = await createProcessing();
    const reservation = tryReserveQsr(20, 1000)!;

    const outcome = await executeFuse(req, 'low', reservation);

    expect(outcome).toEqual({ ok: false, code: 'QUEUE_FULL' });
    expect(getReservedQsr()).toBe(0);
    const saved = await FuseRequest.findById(req._id);
    expect(saved?.status).toBe('failed');
    expect(saved?.errorMessage).toBe('Send queue full');
  });

  it('logs queue-full rejections once per 10s with a suppressed count', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(logger, 'warn');
    mockSend.mockRejectedValue(new SendQueueFullError());

    for (let i = 0; i < 5; i++) {
      const req = await FuseRequest.create({ beneficiary: `${addr}${i}`, tier: 'low', ipAddress: '1.2.3.4', status: 'processing' });
      await executeFuse(req, 'low', tryReserveQsr(20, 1000)!);
    }
    const queueFullLogs = () => warn.mock.calls.filter((c) => String(c[0]) === 'Fuse rejected: send queue full');
    expect(queueFullLogs()).toHaveLength(1);

    // Next interval: one more line carrying the four suppressed rejections.
    await vi.advanceTimersByTimeAsync(10_000);
    const req = await FuseRequest.create({ beneficiary: `${addr}x`, tier: 'low', ipAddress: '1.2.3.4', status: 'processing' });
    await executeFuse(req, 'low', tryReserveQsr(20, 1000)!);
    expect(queueFullLogs()).toHaveLength(2);
    expect((queueFullLogs()[1] as unknown[])[1]).toMatchObject({ suppressedSinceLastLog: 4 });
    warn.mockRestore();
  });

  it('holds the reservation across the window when the send fails', async () => {
    vi.useFakeTimers();
    mockSend.mockRejectedValueOnce(new Error('Send timeout after 30000ms'));
    const req = await createProcessing();
    const reservation = tryReserveQsr(20, 1000)!;

    const outcome = await executeFuse(req, 'low', reservation);

    expect(outcome).toEqual({ ok: false, code: 'FUSE_FAILED' });
    const saved = await FuseRequest.findById(req._id);
    expect(saved?.status).toBe('failed');
    expect(getReservedQsr()).toBe(20);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(getReservedQsr()).toBe(0);
  });
});
