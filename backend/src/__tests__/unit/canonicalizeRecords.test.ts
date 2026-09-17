import { describe, it, expect } from 'vitest';
import { FuseRequest } from '../../models/FuseRequest.js';
import { Fusion } from '../../models/Fusion.js';
import { canonicalizeStoredAddresses } from '../../services/canonicalizeRecords.js';

const lower = 'z1qrjdhy65zds69a96xlhheu4sy689k34x4hpse0';
const upper = lower.toUpperCase();

describe('canonicalizeStoredAddresses', () => {
  it('lowercases non-canonical beneficiaries in both collections', async () => {
    await FuseRequest.collection.insertOne({
      beneficiary: upper, tier: 'low', ipAddress: 'telegram', source: 'telegram',
      telegramUserId: 1, status: 'completed', createdAt: new Date(), updatedAt: new Date(),
    });
    await Fusion.collection.insertOne({
      beneficiary: upper, tier: 'low', qsrAmount: 2000000000, txHash: 'tx-upper',
      status: 'active', fusedAt: new Date(), fusionId: 'f-1',
    });
    await Fusion.create({
      beneficiary: lower, tier: 'low', qsrAmount: 2000000000, txHash: 'tx-lower',
      status: 'active', fusedAt: new Date(),
    });

    await canonicalizeStoredAddresses();

    expect(await FuseRequest.countDocuments({ beneficiary: upper })).toBe(0);
    expect(await FuseRequest.countDocuments({ beneficiary: lower })).toBe(1);
    // Both real fusions are kept under the canonical key.
    expect(await Fusion.countDocuments({ beneficiary: upper })).toBe(0);
    expect(await Fusion.countDocuments({ beneficiary: lower, status: 'active' })).toBe(2);
  });

  it('fails a processing lock that would collide with a live canonical lock', async () => {
    await FuseRequest.syncIndexes();
    await FuseRequest.create({
      beneficiary: lower, tier: 'low', ipAddress: '1.2.3.4', source: 'web', status: 'processing',
    });
    await FuseRequest.collection.insertOne({
      beneficiary: upper, tier: 'low', ipAddress: 'telegram', source: 'telegram',
      telegramUserId: 1, status: 'processing', createdAt: new Date(), updatedAt: new Date(),
    });

    await canonicalizeStoredAddresses();

    expect(await FuseRequest.countDocuments({ beneficiary: lower, status: 'processing' })).toBe(1);
    const superseded = await FuseRequest.findOne({ beneficiary: upper });
    expect(superseded?.status).toBe('failed');
    expect(superseded?.errorMessage).toContain('duplicate processing lock');
  });

  it('is a no-op when everything is already canonical', async () => {
    await Fusion.create({
      beneficiary: lower, tier: 'low', qsrAmount: 2000000000, txHash: 'tx-1',
      status: 'active', fusedAt: new Date(),
    });
    await expect(canonicalizeStoredAddresses()).resolves.toBeUndefined();
    expect(await Fusion.countDocuments({ beneficiary: lower })).toBe(1);
  });
});
