import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock zenon.ts before importing sendQueue
const mockSend = vi.fn();
vi.mock('../../services/zenon.js', () => ({
  getZenon: () => ({
    send: mockSend,
  }),
}));

import { serializedSend, getSendQueueDepth, MAX_QUEUE_DEPTH, SendQueueFullError } from '../../services/sendQueue.js';

describe('serializedSend', () => {
  const mockBlock = { blockType: 1 } as any;
  const mockKeyPair = { getAddress: () => ({ toString: () => 'z1mock' }) } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  it('calls zenon.send with block and keyPair', async () => {
    mockSend.mockResolvedValueOnce({ hash: 'tx1' });

    const promise = serializedSend(mockBlock, mockKeyPair);
    // Advance past the inter-tx delay
    await vi.advanceTimersByTimeAsync(3000);
    const result = await promise;

    expect(mockSend).toHaveBeenCalledWith(mockBlock, mockKeyPair);
    expect(result).toEqual({ hash: 'tx1' });
  });

  it('serializes concurrent sends', async () => {
    const callOrder: number[] = [];
    mockSend
      .mockImplementationOnce(async () => {
        callOrder.push(1);
        return { hash: 'tx1' };
      })
      .mockImplementationOnce(async () => {
        callOrder.push(2);
        return { hash: 'tx2' };
      });

    const p1 = serializedSend(mockBlock, mockKeyPair);
    const p2 = serializedSend(mockBlock, mockKeyPair);

    // Advance through first send + delay + second send + delay
    await vi.advanceTimersByTimeAsync(10000);

    await p1;
    await p2;

    expect(callOrder).toEqual([1, 2]);
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it('does not poison the queue on error', async () => {
    mockSend
      .mockRejectedValueOnce(new Error('node down'))
      .mockResolvedValueOnce({ hash: 'tx2' });

    const p1 = serializedSend(mockBlock, mockKeyPair);
    const p2 = serializedSend(mockBlock, mockKeyPair);

    await vi.advanceTimersByTimeAsync(10000);

    await expect(p1).rejects.toThrow('node down');
    await expect(p2).resolves.toEqual({ hash: 'tx2' });
  });

  it('times out if send takes too long', async () => {
    // Simulate a send that never resolves
    mockSend.mockImplementationOnce(() => new Promise(() => {}));

    const promise = serializedSend(mockBlock, mockKeyPair);

    // Advance past the 30s timeout
    await vi.advanceTimersByTimeAsync(31_000);

    await expect(promise).rejects.toThrow('Send timeout after 30000ms');
  });

  describe('beforeSend hook', () => {
    it('runs inside the queue slot before zenon.send', async () => {
      const order: string[] = [];
      mockSend.mockImplementationOnce(async () => { order.push('send'); return { hash: 'tx' }; });

      const promise = serializedSend(mockBlock, mockKeyPair, {
        beforeSend: async () => { order.push('before'); },
      });
      await vi.advanceTimersByTimeAsync(3000);
      await promise;

      expect(order).toEqual(['before', 'send']);
    });

    it('skips the send and rejects when the hook throws, without poisoning the queue', async () => {
      mockSend.mockResolvedValue({ hash: 'tx' });

      const first = serializedSend(mockBlock, mockKeyPair, {
        beforeSend: async () => { throw new Error('lease lost'); },
      });
      const second = serializedSend(mockBlock, mockKeyPair);
      const firstAssertion = expect(first).rejects.toThrow('lease lost');

      await vi.advanceTimersByTimeAsync(3000);
      await firstAssertion;
      await second;

      expect(mockSend).toHaveBeenCalledTimes(1);
    });
  });

  describe('beforeSend timeout', () => {
    it('times out a never-settling hook and lets the next job proceed', async () => {
      mockSend.mockResolvedValue({ hash: 'tx' });

      const stuck = serializedSend(mockBlock, mockKeyPair, {
        beforeSend: () => new Promise<void>(() => undefined),
      });
      const next = serializedSend(mockBlock, mockKeyPair);
      const stuckAssertion = expect(stuck).rejects.toThrow(/timeout after 5000ms/);

      await vi.advanceTimersByTimeAsync(5000); // hook timeout
      await stuckAssertion;
      await vi.advanceTimersByTimeAsync(3000); // next job's send + inter-tx delay
      await expect(next).resolves.toEqual({ hash: 'tx' });

      expect(mockSend).toHaveBeenCalledTimes(1); // the stuck job never sent
      expect(getSendQueueDepth()).toBe(0);
    });
  });

  describe('queue depth bound', () => {
    it('priority (maintenance) jobs are admitted when the queue is full', async () => {
      mockSend.mockResolvedValue({ hash: 'tx' });
      const queued: Promise<unknown>[] = [];
      for (let i = 0; i < MAX_QUEUE_DEPTH; i++) {
        queued.push(serializedSend(mockBlock, mockKeyPair));
      }
      await expect(serializedSend(mockBlock, mockKeyPair)).rejects.toBeInstanceOf(SendQueueFullError);

      const maintenance = serializedSend(mockBlock, mockKeyPair, { priority: true });
      expect(getSendQueueDepth()).toBe(MAX_QUEUE_DEPTH + 1);

      await vi.advanceTimersByTimeAsync(3000 * (MAX_QUEUE_DEPTH + 1));
      await Promise.all(queued);
      await expect(maintenance).resolves.toEqual({ hash: 'tx' });
      expect(mockSend).toHaveBeenCalledTimes(MAX_QUEUE_DEPTH + 1);
    });

    it('rejects immediately once MAX_QUEUE_DEPTH jobs are waiting, then recovers', async () => {
      mockSend.mockResolvedValue({ hash: 'tx' });
      const queued: Promise<unknown>[] = [];
      for (let i = 0; i < MAX_QUEUE_DEPTH; i++) {
        queued.push(serializedSend(mockBlock, mockKeyPair));
      }
      expect(getSendQueueDepth()).toBe(MAX_QUEUE_DEPTH);

      await expect(serializedSend(mockBlock, mockKeyPair)).rejects.toBeInstanceOf(SendQueueFullError);

      // Drain the queue (each job costs the inter-tx delay).
      await vi.advanceTimersByTimeAsync(3000 * MAX_QUEUE_DEPTH);
      await Promise.all(queued);
      expect(getSendQueueDepth()).toBe(0);

      const after = serializedSend(mockBlock, mockKeyPair);
      await vi.advanceTimersByTimeAsync(3000);
      await expect(after).resolves.toEqual({ hash: 'tx' });
    });
  });
});
