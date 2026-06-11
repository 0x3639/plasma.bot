import { Address } from 'znn-typescript-sdk';
import { getZenon } from './zenon.js';
import { getKeyPair, getWalletAddress } from './wallet.js';
import { serializedSend } from './sendQueue.js';
import { CONFIG, type FuseTier } from '../config/index.js';
import { Fusion } from '../models/Fusion.js';
import { logger } from '../utils/logger.js';

/** Shape of an on-chain fusion entry as consumed by reconcile/unfuse/limiter. */
export interface ChainFusionEntry {
  id: { toString(): string };
  beneficiary?: { toString(): string };
  qsrAmount?: { toString(): string };
  expirationHeight?: number | string;
}

// SDK default page size (RPC_MAX_PAGE_SIZE). 20 pages = 20480 entries, far
// beyond any realistic fusion count for one wallet — hitting it means
// something is very wrong, so we fail closed rather than act on a partial list.
const ENTRIES_PAGE_SIZE = 1024;
const ENTRIES_MAX_PAGES = 20;

/**
 * Fetch ALL of the wallet's on-chain fusion entries, paging until exhausted.
 *
 * A single getEntriesByAddress() call returns at most one page (1024 entries).
 * Consumers that treat absence from the list as meaningful (reconcile failing
 * stale pendings, unfuse marking records unfused, the availability check)
 * MUST see the complete list — acting on one page would silently misclassify
 * entries beyond it. Throws if the list cannot be fetched completely.
 */
export async function getAllFusionEntries(): Promise<ChainFusionEntry[]> {
  const zenon = getZenon();
  const walletAddress = getWalletAddress();
  const all: ChainFusionEntry[] = [];

  for (let page = 0; page < ENTRIES_MAX_PAGES; page++) {
    const response = await zenon.embedded.plasma.getEntriesByAddress(walletAddress, page, ENTRIES_PAGE_SIZE);
    const list: ChainFusionEntry[] = response?.list || [];
    all.push(...list);
    if (list.length < ENTRIES_PAGE_SIZE) {
      return all;
    }
  }

  throw new Error(`Fusion entry pagination exceeded ${ENTRIES_MAX_PAGES} pages; refusing to act on a partial list`);
}

/**
 * Fuse QSR to a beneficiary address.
 * Returns the created Fusion document.
 */
export async function fuseToAddress(
  beneficiaryStr: string,
  tier: FuseTier,
): Promise<typeof Fusion.prototype> {
  const zenon = getZenon();
  const keyPair = getKeyPair();
  const tierConfig = CONFIG.FUSE_TIERS[tier];
  const qsrHuman = tierConfig.qsr;

  // Convert to base units (8 decimals)
  const qsrBaseUnits = BigInt(qsrHuman) * BigInt(10 ** CONFIG.QSR_DECIMALS);

  const beneficiary = Address.parse(beneficiaryStr);

  logger.info('Fusing QSR', {
    beneficiary: beneficiaryStr,
    tier,
    qsr: qsrHuman,
  });

  // Create the fuse block
  const fuseBlock = zenon.embedded.plasma.fuse(beneficiary, qsrBaseUnits.toString());

  // Send via serialized queue
  const result = await serializedSend(fuseBlock, keyPair) as { hash?: { toString(): string } };

  const txHash = result?.hash?.toString() || 'unknown';

  // Record in database as 'pending'. A returned txHash means the block was
  // published, not that the fuse succeeded on-chain — reconcile promotes this
  // to 'active' once it matches a real chain entry. This prevents a rejected
  // fuse from leaving a phantom 'active' record that blocks the address.
  const fusion = await Fusion.create({
    beneficiary: beneficiaryStr,
    tier,
    qsrAmount: Number(qsrBaseUnits),
    txHash,
    status: 'pending',
    fusedAt: new Date(),
  });

  logger.info('Fusion created', {
    id: fusion._id,
    txHash,
    beneficiary: beneficiaryStr,
    tier,
    qsr: qsrHuman,
  });

  return fusion;
}
