import { Address } from 'znn-typescript-sdk';
import { getZenon } from './zenon.js';
import { getKeyPair } from './wallet.js';
import { serializedSend } from './sendQueue.js';
import { CONFIG, type FuseTier } from '../config/index.js';
import { Fusion } from '../models/Fusion.js';
import { logger } from '../utils/logger.js';

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

  // Record in database
  const fusion = await Fusion.create({
    beneficiary: beneficiaryStr,
    tier,
    qsrAmount: Number(qsrBaseUnits),
    txHash,
    status: 'active',
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
