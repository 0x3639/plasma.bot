import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Fusion } from '../../models/Fusion.js';
import { reconcileFusionIds } from '../../cron/reconcile.js';
import { createMockAddress, createMockFusionEntry } from '../setup/mocks.js';

// Mock zenon and wallet
const mockGetEntriesByAddress = vi.fn();
vi.mock('../../services/zenon.js', () => ({
  getZenon: () => ({
    embedded: {
      plasma: {
        getEntriesByAddress: mockGetEntriesByAddress,
      },
    },
  }),
}));

vi.mock('../../services/wallet.js', () => ({
  getWalletAddress: () => createMockAddress(),
}));

describe('reconcileFusionIds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does nothing when there are no unreconciled fusions', async () => {
    await reconcileFusionIds();
    expect(mockGetEntriesByAddress).not.toHaveBeenCalled();
  });

  it('matches chain entries to unreconciled DB records', async () => {
    const addr = 'z1qrjdhy65zds69a96xlhheu4sy689k34x4hpse0';
    const qsrBase = 2000000000; // 20 QSR

    // Create unreconciled fusion in DB
    await Fusion.create({
      beneficiary: addr,
      tier: 'low',
      qsrAmount: qsrBase,
      txHash: 'tx-abc',
      status: 'active',
      fusedAt: new Date(),
      fusionId: null,
    });

    // Mock chain entry with matching beneficiary and amount
    mockGetEntriesByAddress.mockResolvedValueOnce({
      list: [createMockFusionEntry({
        id: 'chain-fusion-id-1',
        beneficiary: addr,
        qsrAmount: qsrBase,
        expirationHeight: 500000,
      })],
    });

    await reconcileFusionIds();

    const updated = await Fusion.findOne({ beneficiary: addr });
    expect(updated?.fusionId).toBe('chain-fusion-id-1');
    expect(updated?.expirationHeight).toBe(500000);
  });

  it('does not rematch already-used fusion IDs', async () => {
    const addr1 = 'z1qrjdhy65zds69a96xlhheu4sy689k34x4hpse0';
    const addr2 = 'z1qp972aed9levp34gwn32xw24j2evsmcmu6knx0';
    const qsrBase = 2000000000;

    // Already reconciled fusion
    await Fusion.create({
      beneficiary: addr1,
      tier: 'low',
      qsrAmount: qsrBase,
      txHash: 'tx-1',
      status: 'active',
      fusedAt: new Date(),
      fusionId: 'already-used-id',
      expirationHeight: 400000,
    });

    // Unreconciled fusion
    await Fusion.create({
      beneficiary: addr2,
      tier: 'low',
      qsrAmount: qsrBase,
      txHash: 'tx-2',
      status: 'active',
      fusedAt: new Date(),
      fusionId: null,
    });

    // Chain has both entries
    mockGetEntriesByAddress.mockResolvedValueOnce({
      list: [
        createMockFusionEntry({
          id: 'already-used-id',
          beneficiary: addr1,
          qsrAmount: qsrBase,
        }),
        createMockFusionEntry({
          id: 'new-chain-id',
          beneficiary: addr2,
          qsrAmount: qsrBase,
          expirationHeight: 600000,
        }),
      ],
    });

    await reconcileFusionIds();

    const unreconciled = await Fusion.findOne({ beneficiary: addr2 });
    expect(unreconciled?.fusionId).toBe('new-chain-id');
    expect(unreconciled?.expirationHeight).toBe(600000);
  });

  it('handles empty chain entry list gracefully', async () => {
    await Fusion.create({
      beneficiary: 'z1qrjdhy65zds69a96xlhheu4sy689k34x4hpse0',
      tier: 'low',
      qsrAmount: 2000000000,
      txHash: 'tx-abc',
      status: 'active',
      fusedAt: new Date(),
      fusionId: null,
    });

    mockGetEntriesByAddress.mockResolvedValueOnce({ list: [] });
    await reconcileFusionIds();

    const fusion = await Fusion.findOne({});
    expect(fusion?.fusionId).toBeNull();
  });
});
