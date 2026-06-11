import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Fusion } from '../../models/Fusion.js';
import { FuseRequest } from '../../models/FuseRequest.js';
import { reconcileFusionIds, failStaleProcessingRequests } from '../../cron/reconcile.js';
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

  it('does nothing when chain returns no entries', async () => {
    mockGetEntriesByAddress.mockResolvedValueOnce({ list: [] });
    await reconcileFusionIds();
    expect(mockGetEntriesByAddress).toHaveBeenCalled();
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

  it('creates DB record for orphaned chain entry with no DB match', async () => {
    const addr = 'z1qrjdhy65zds69a96xlhheu4sy689k34x4hpse0';
    const qsrBase = 2000000000;

    // No DB records exist — chain entry is "orphaned"
    mockGetEntriesByAddress.mockResolvedValueOnce({
      list: [createMockFusionEntry({
        id: 'orphan-chain-id',
        beneficiary: addr,
        qsrAmount: qsrBase,
        expirationHeight: 700000,
      })],
    });

    await reconcileFusionIds();

    const created = await Fusion.findOne({ fusionId: 'orphan-chain-id' });
    expect(created).not.toBeNull();
    expect(created?.beneficiary).toBe(addr);
    expect(created?.qsrAmount).toBe(qsrBase);
    expect(created?.expirationHeight).toBe(700000);
    expect(created?.status).toBe('active');
  });

  it('promotes a pending fusion to active when it matches a chain entry', async () => {
    const addr = 'z1qrjdhy65zds69a96xlhheu4sy689k34x4hpse0';
    const qsrBase = 12000000000; // 120 QSR

    await Fusion.create({
      beneficiary: addr,
      tier: 'high',
      qsrAmount: qsrBase,
      txHash: 'tx-pending',
      status: 'pending',
      fusedAt: new Date(),
      fusionId: null,
    });

    mockGetEntriesByAddress.mockResolvedValueOnce({
      list: [createMockFusionEntry({
        id: 'chain-pending-1',
        beneficiary: addr,
        qsrAmount: qsrBase,
        expirationHeight: 800000,
      })],
    });

    await reconcileFusionIds();

    const updated = await Fusion.findOne({ beneficiary: addr });
    expect(updated?.status).toBe('active');
    expect(updated?.fusionId).toBe('chain-pending-1');
    expect(updated?.expirationHeight).toBe(800000);
  });

  it('fails a stale pending fusion that never appeared on-chain', async () => {
    const stuckAddr = 'z1qrjdhy65zds69a96xlhheu4sy689k34x4hpse0';
    const otherAddr = 'z1qp972aed9levp34gwn32xw24j2evsmcmu6knx0';

    // Pending for 11 minutes (past the 10-min grace window) — the send never landed.
    await Fusion.create({
      beneficiary: stuckAddr,
      tier: 'low',
      qsrAmount: 2000000000,
      txHash: 'tx-stuck',
      status: 'pending',
      fusedAt: new Date(Date.now() - 11 * 60 * 1000),
      fusionId: null,
    });

    // Chain has an unrelated entry (non-empty list), but nothing for stuckAddr.
    mockGetEntriesByAddress.mockResolvedValueOnce({
      list: [createMockFusionEntry({ id: 'unrelated-1', beneficiary: otherAddr, qsrAmount: 2000000000 })],
    });

    await reconcileFusionIds();

    const stuck = await Fusion.findOne({ beneficiary: stuckAddr });
    expect(stuck?.status).toBe('failed');
  });

  it('does not fail a fresh pending fusion within the grace window', async () => {
    const addr = 'z1qrjdhy65zds69a96xlhheu4sy689k34x4hpse0';
    const otherAddr = 'z1qp972aed9levp34gwn32xw24j2evsmcmu6knx0';

    await Fusion.create({
      beneficiary: addr,
      tier: 'low',
      qsrAmount: 2000000000,
      txHash: 'tx-fresh',
      status: 'pending',
      fusedAt: new Date(), // just now
      fusionId: null,
    });

    mockGetEntriesByAddress.mockResolvedValueOnce({
      list: [createMockFusionEntry({ id: 'unrelated-2', beneficiary: otherAddr, qsrAmount: 2000000000 })],
    });

    await reconcileFusionIds();

    const fresh = await Fusion.findOne({ beneficiary: addr });
    expect(fresh?.status).toBe('pending'); // still waiting for confirmation
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

  it('fails a stale pending fusion even when the chain has no entries at all', async () => {
    // An empty (but successful) chain query is meaningful: the fuse never
    // landed, so the stale pending must still be failed to free the address.
    await Fusion.create({
      beneficiary: 'z1qrjdhy65zds69a96xlhheu4sy689k34x4hpse0',
      tier: 'low',
      qsrAmount: 2000000000,
      txHash: 'tx-stuck-empty',
      status: 'pending',
      fusedAt: new Date(Date.now() - 11 * 60 * 1000),
      fusionId: null,
    });

    mockGetEntriesByAddress.mockResolvedValueOnce({ list: [] });
    await reconcileFusionIds();

    const fusion = await Fusion.findOne({});
    expect(fusion?.status).toBe('failed');
  });
});

describe('failStaleProcessingRequests', () => {
  it('fails processing requests older than the grace window', async () => {
    const stale = await FuseRequest.create({
      beneficiary: 'z1qrjdhy65zds69a96xlhheu4sy689k34x4hpse0',
      tier: 'low',
      ipAddress: '1.2.3.4',
      status: 'processing',
    });
    // Backdate past the 10-minute grace window (createdAt is set by Mongoose
    // timestamps, so update it directly).
    await FuseRequest.collection.updateOne(
      { _id: stale._id },
      { $set: { createdAt: new Date(Date.now() - 11 * 60 * 1000) } },
    );

    await failStaleProcessingRequests();

    const updated = await FuseRequest.findById(stale._id);
    expect(updated?.status).toBe('failed');
    expect(updated?.errorMessage).toContain('Stale processing');
  });

  it('leaves fresh in-flight processing requests alone', async () => {
    const fresh = await FuseRequest.create({
      beneficiary: 'z1qrjdhy65zds69a96xlhheu4sy689k34x4hpse0',
      tier: 'low',
      ipAddress: '1.2.3.4',
      status: 'processing',
    });

    await failStaleProcessingRequests();

    const updated = await FuseRequest.findById(fresh._id);
    expect(updated?.status).toBe('processing');
  });
});
