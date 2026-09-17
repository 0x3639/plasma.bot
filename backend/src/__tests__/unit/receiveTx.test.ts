import { describe, it, expect, vi, beforeEach } from 'vitest';
import { receiveAllPending } from '../../services/receiveTx.js';
import { createMockAddress } from '../setup/mocks.js';

const mockGetUnreceived = vi.fn();
const mockSend = vi.fn().mockResolvedValue({});
const mockReceive = vi.fn().mockReturnValue({ blockType: 2 });

vi.mock('../../services/zenon.js', () => ({
  getZenon: () => ({
    ledger: {
      getUnreceivedBlocksByAddress: mockGetUnreceived,
    },
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
    serializedSend: (...args: unknown[]) => mockSend(...args),
  };
});
import { SendQueueFullError } from '../../services/sendQueue.js';

vi.mock('znn-typescript-sdk', async () => {
  const actual = await vi.importActual('znn-typescript-sdk') as Record<string, unknown>;
  return {
    ...actual,
    AccountBlockTemplate: {
      receive: (...args: unknown[]) => mockReceive(...args),
    },
  };
});

describe('receiveAllPending', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 0 when no unreceived blocks', async () => {
    mockGetUnreceived.mockResolvedValueOnce({ list: [] });
    const count = await receiveAllPending();
    expect(count).toBe(0);
  });

  it('returns 0 when unreceived response is null', async () => {
    mockGetUnreceived.mockResolvedValueOnce(null);
    const count = await receiveAllPending();
    expect(count).toBe(0);
  });

  it('receives pending blocks and returns count', async () => {
    mockGetUnreceived.mockResolvedValueOnce({
      list: [
        { hash: { toString: () => 'hash-1' } },
        { hash: { toString: () => 'hash-2' } },
      ],
    });

    const count = await receiveAllPending();
    expect(count).toBe(2);
    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(mockReceive).toHaveBeenCalledTimes(2);
  });

  it('continues receiving after individual block failure', async () => {
    mockGetUnreceived.mockResolvedValueOnce({
      list: [
        { hash: { toString: () => 'hash-1' } },
        { hash: { toString: () => 'hash-2' } },
        { hash: { toString: () => 'hash-3' } },
      ],
    });

    mockSend
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('send failed'))
      .mockResolvedValueOnce({});

    const count = await receiveAllPending();
    // 2 succeeded, 1 failed
    expect(count).toBe(2);
    expect(mockSend).toHaveBeenCalledTimes(3);
  });

  it('sends receives on the maintenance (priority) lane', async () => {
    mockGetUnreceived.mockResolvedValueOnce({ list: [{ hash: 'h1' }] });
    await receiveAllPending();
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0][2]).toEqual({ priority: true });
  });

  it('stops the cycle on a full send queue instead of refetching the same page', async () => {
    // A full page of 50 blocks that never shrinks because nothing is sent.
    const fullPage = { list: Array.from({ length: 50 }, (_, i) => ({ hash: `h${i}` })) };
    mockGetUnreceived.mockResolvedValue(fullPage);
    mockSend.mockRejectedValue(new SendQueueFullError());

    const count = await receiveAllPending();

    expect(count).toBe(0);
    expect(mockGetUnreceived).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});
