import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Fusion } from '../../models/Fusion.js';
import { runUnfuseCycle } from '../../services/unfuse.js';
import { createMockAddress, createMockAccountInfo, createMockFusionEntry } from '../setup/mocks.js';

const mockSend = vi.fn();
const mockCancel = vi.fn().mockReturnValue({ blockType: 5 });
const mockGetAccountInfo = vi.fn();
const mockGetEntriesByAddress = vi.fn();

vi.mock('../../services/zenon.js', () => ({
  getZenon: () => ({
    ledger: {
      getAccountInfoByAddress: mockGetAccountInfo,
      getFrontierMomentum: vi.fn().mockResolvedValue({ height: 1_000_000 }),
    },
    embedded: { plasma: { cancel: mockCancel, getEntriesByAddress: mockGetEntriesByAddress } },
  }),
}));
vi.mock('../../services/wallet.js', () => ({
  getKeyPair: () => ({ getAddress: () => createMockAddress() }),
  getWalletAddress: () => createMockAddress(),
}));
vi.mock('../../services/sendQueue.js', async () => {
  const actual = await vi.importActual('../../services/sendQueue.js') as Record<string, unknown>;
  return { ...actual, serializedSend: (...args: unknown[]) => mockSend(...args) };
});
vi.mock('znn-typescript-sdk', async () => {
  const actual = await vi.importActual('znn-typescript-sdk') as Record<string, unknown>;
  return {
    ...actual,
    Hash: { parse: (h: string) => h },
    QSR_ZTS: { toString: () => 'zts1qsrxxxxxxxxxxxxxmerced' },
  };
});
vi.mock('../../config/index.js', async () => {
  const actual = await vi.importActual('../../config/index.js') as Record<string, unknown>;
  return { ...actual, CONFIG: { ...(actual.CONFIG as Record<string, unknown>), BALANCE_THRESHOLD_QSR: 500 } };
});

const addr = 'z1qrjdhy65zds69a96xlhheu4sy689k34x4hpse0';

async function revocableFusion(fusionId = 'fusion-1') {
  return Fusion.create({
    beneficiary: addr, tier: 'low', qsrAmount: 2000000000, txHash: `tx-${fusionId}`,
    status: 'active', fusedAt: new Date(), fusionId, expirationHeight: 10,
  });
}

describe('runUnfuseCycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    mockGetAccountInfo.mockResolvedValue(createMockAccountInfo(100)); // below threshold
    mockGetEntriesByAddress.mockResolvedValue({ list: [createMockFusionEntry({ id: 'fusion-1', beneficiary: addr })] });
    mockSend.mockResolvedValue({ hash: { toString: () => 'cancel-tx' } });
  });

  it('cancels on the maintenance (priority) lane and marks the fusion unfused', async () => {
    const fusion = await revocableFusion();

    await runUnfuseCycle();

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0][2]).toEqual({ priority: true });
    const updated = await Fusion.findById(fusion._id);
    expect(updated?.status).toBe('unfused');
    expect(updated?.unfusedAt).toBeInstanceOf(Date);
  });

  it('rolls the claim back to active when the maintenance send fails', async () => {
    const fusion = await revocableFusion();
    mockSend.mockRejectedValueOnce(new Error('Send timeout after 30000ms'));

    await runUnfuseCycle();

    const updated = await Fusion.findById(fusion._id);
    expect(updated?.status).toBe('active');
    expect(updated?.unfusedAt ?? null).toBeNull();
  });
});
