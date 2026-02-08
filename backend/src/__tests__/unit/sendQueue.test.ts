import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock zenon.ts before importing sendQueue
const mockSend = vi.fn();
vi.mock('../../services/zenon.js', () => ({
  getZenon: () => ({
    send: mockSend,
  }),
}));

import { serializedSend } from '../../services/sendQueue.js';

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
});
