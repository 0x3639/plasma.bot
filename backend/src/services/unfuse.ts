import { Hash } from 'znn-typescript-sdk';
import { getZenon } from './zenon.js';
import { getKeyPair, getWalletAddress } from './wallet.js';
import { serializedSend } from './sendQueue.js';
import { getQsrBalance } from './balance.js';
import { CONFIG } from '../config/index.js';
import { Fusion } from '../models/Fusion.js';
import { logger } from '../utils/logger.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run the FIFO unfuse cycle.
 * If wallet balance < threshold, unfuse oldest fusions first (that are at least 12h old)
 * until balance >= threshold.
 */
export async function runUnfuseCycle(): Promise<void> {
  const balance = await getQsrBalance();

  if (balance >= CONFIG.BALANCE_THRESHOLD_QSR) {
    logger.debug(`Balance OK: ${balance} QSR >= ${CONFIG.BALANCE_THRESHOLD_QSR} threshold`);
    return;
  }

  logger.info(`Balance below threshold: ${balance} QSR < ${CONFIG.BALANCE_THRESHOLD_QSR}. Starting unfuse cycle.`);

  const now = Date.now();
  const minFuseAge = new Date(now - CONFIG.MIN_FUSE_DURATION_MS);

  // Get active fusions ordered by fusedAt ascending (oldest first = FIFO)
  // Only consider fusions older than 12 hours
  const activeFusions = await Fusion.find({
    status: 'active',
    fusedAt: { $lte: minFuseAge },
  })
    .sort({ fusedAt: 1 })
    .exec();

  if (activeFusions.length === 0) {
    // Check if there are fusions that are too young to unfuse
    const youngFusions = await Fusion.findOne({ status: 'active' })
      .sort({ fusedAt: 1 })
      .exec();

    if (youngFusions) {
      const unfuseableAt = new Date(youngFusions.fusedAt.getTime() + CONFIG.MIN_FUSE_DURATION_MS);
      const hoursRemaining = Math.ceil((unfuseableAt.getTime() - now) / (60 * 60 * 1000));
      logger.warn(`No fusions old enough to unfuse. Earliest unfuse possible in ~${hoursRemaining}h.`);
    } else {
      logger.warn('No active fusions to unfuse. Balance may recover via other means.');
    }
    return;
  }

  // Get on-chain fusion entries to check revocability
  const zenon = getZenon();
  const walletAddress = getWalletAddress();
  const chainEntries = await zenon.embedded.plasma.getEntriesByAddress(walletAddress);

  const chainEntryMap = new Map<string, { isRevocable: boolean; id: { toString(): string } }>();
  if (chainEntries?.list) {
    for (const entry of chainEntries.list) {
      chainEntryMap.set(entry.id.toString(), entry);
    }
  }

  let expectedBalance = balance;
  let unfusedCount = 0;
  const keyPair = getKeyPair();

  for (const fusion of activeFusions) {
    if (expectedBalance >= CONFIG.BALANCE_THRESHOLD_QSR) {
      logger.info(`Expected balance ${expectedBalance} >= threshold. Stopping unfuse.`);
      break;
    }

    if (!fusion.fusionId) {
      logger.debug(`Fusion ${fusion._id} not yet reconciled. Skipping.`);
      continue;
    }

    const chainEntry = chainEntryMap.get(fusion.fusionId);

    if (!chainEntry) {
      // Entry no longer exists on-chain (already cancelled externally?)
      logger.warn(`Fusion ${fusion.fusionId} not found on-chain. Marking as unfused.`);
      fusion.status = 'unfused';
      fusion.unfusedAt = new Date();
      await fusion.save();
      continue;
    }

    if (!chainEntry.isRevocable) {
      logger.debug(`Fusion ${fusion.fusionId} not yet revocable on-chain. Skipping.`);
      continue;
    }

    try {
      const cancelBlock = zenon.embedded.plasma.cancel(Hash.parse(fusion.fusionId));
      await serializedSend(cancelBlock, keyPair);

      fusion.status = 'unfused';
      fusion.unfusedAt = new Date();
      await fusion.save();

      const fusionQsr = fusion.qsrAmount / Math.pow(10, CONFIG.QSR_DECIMALS);
      expectedBalance += fusionQsr;
      unfusedCount++;

      logger.info(`Unfused ${fusionQsr} QSR from ${fusion.beneficiary}. Expected balance: ${expectedBalance}`);

      // Brief delay between transactions
      await sleep(2000);
    } catch (error) {
      logger.error(`Failed to unfuse ${fusion.fusionId}`, { error });
    }
  }

  logger.info(`Unfuse cycle complete. Unfused ${unfusedCount} fusions. Expected balance: ${expectedBalance}`);
}

/**
 * Get the estimated time until the next fusion can be unfused.
 * Returns null if there are no active fusions or some are already unfuseable.
 */
export async function getNextUnfuseTime(): Promise<Date | null> {
  const oldest = await Fusion.findOne({ status: 'active' })
    .sort({ fusedAt: 1 })
    .exec();

  if (!oldest) return null;

  const unfuseableAt = new Date(oldest.fusedAt.getTime() + CONFIG.MIN_FUSE_DURATION_MS);

  // If already past 12h, it's unfuseable now
  if (unfuseableAt.getTime() <= Date.now()) return null;

  return unfuseableAt;
}
