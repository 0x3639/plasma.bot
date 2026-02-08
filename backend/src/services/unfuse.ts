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

// Momentums are produced roughly every 10 seconds
const SECONDS_PER_MOMENTUM = 10;

/**
 * Run the FIFO unfuse cycle.
 * If wallet balance < threshold, unfuse oldest revocable fusions first
 * until balance >= threshold. Uses on-chain expirationHeight to determine
 * when a fusion is revocable.
 */
export async function runUnfuseCycle(): Promise<void> {
  const balance = await getQsrBalance();

  if (balance >= CONFIG.BALANCE_THRESHOLD_QSR) {
    logger.debug(`Balance OK: ${balance} QSR >= ${CONFIG.BALANCE_THRESHOLD_QSR} threshold`);
    return;
  }

  logger.info(`Balance below threshold: ${balance} QSR < ${CONFIG.BALANCE_THRESHOLD_QSR}. Starting unfuse cycle.`);

  // Get current momentum height
  const zenon = getZenon();
  const frontierMomentum = await zenon.ledger.getFrontierMomentum();
  const currentHeight = Number(frontierMomentum?.height || 0);

  // Get reconciled active fusions that are revocable (expirationHeight <= currentHeight)
  // Ordered oldest first (FIFO)
  const revocableFusions = await Fusion.find({
    status: 'active',
    fusionId: { $ne: null },
    expirationHeight: { $ne: null, $lte: currentHeight },
  })
    .sort({ fusedAt: 1 })
    .exec();

  if (revocableFusions.length === 0) {
    // Check if there are fusions that aren't revocable yet
    const nextFusion = await Fusion.findOne({
      status: 'active',
      expirationHeight: { $ne: null, $gt: currentHeight },
    })
      .sort({ expirationHeight: 1 })
      .exec();

    if (nextFusion) {
      const heightDiff = nextFusion.expirationHeight! - currentHeight;
      const minutesRemaining = Math.ceil((heightDiff * SECONDS_PER_MOMENTUM) / 60);
      logger.warn(`No revocable fusions. Earliest in ~${minutesRemaining}min (height ${nextFusion.expirationHeight}, current ${currentHeight}).`);
    } else {
      // Check for unreconciled fusions
      const unreconciledCount = await Fusion.countDocuments({
        status: 'active',
        $or: [{ fusionId: null }, { expirationHeight: null }],
      });
      if (unreconciledCount > 0) {
        logger.warn(`${unreconciledCount} active fusion(s) not yet reconciled. Waiting for reconciliation.`);
      } else {
        logger.warn('No active fusions to unfuse.');
      }
    }
    return;
  }

  // Verify entries still exist on-chain before cancelling
  const walletAddress = getWalletAddress();
  const chainEntries = await zenon.embedded.plasma.getEntriesByAddress(walletAddress);
  const chainIds = new Set<string>();
  if (chainEntries?.list) {
    for (const entry of chainEntries.list) {
      chainIds.add(entry.id.toString());
    }
  }

  let expectedBalance = balance;
  let unfusedCount = 0;
  const keyPair = getKeyPair();

  for (const fusion of revocableFusions) {
    if (expectedBalance >= CONFIG.BALANCE_THRESHOLD_QSR) {
      logger.info(`Expected balance ${expectedBalance} >= threshold. Stopping unfuse.`);
      break;
    }

    if (!chainIds.has(fusion.fusionId!)) {
      logger.warn(`Fusion ${fusion.fusionId} not found on-chain. Marking as unfused.`);
      fusion.status = 'unfused';
      fusion.unfusedAt = new Date();
      await fusion.save();
      continue;
    }

    try {
      const cancelBlock = zenon.embedded.plasma.cancel(Hash.parse(fusion.fusionId!));
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
 * Uses expirationHeight and current momentum height to estimate.
 * Returns null if there are no active fusions or some are already revocable.
 */
export async function getNextUnfuseTime(): Promise<Date | null> {
  const zenon = getZenon();
  const frontierMomentum = await zenon.ledger.getFrontierMomentum();
  const currentHeight = Number(frontierMomentum?.height || 0);

  // Check if any fusion is already revocable
  const revocable = await Fusion.findOne({
    status: 'active',
    fusionId: { $ne: null },
    expirationHeight: { $ne: null, $lte: currentHeight },
  }).exec();

  if (revocable) return null; // Already revocable

  // Find the next fusion to become revocable
  const nextFusion = await Fusion.findOne({
    status: 'active',
    expirationHeight: { $ne: null, $gt: currentHeight },
  })
    .sort({ expirationHeight: 1 })
    .exec();

  if (!nextFusion || !nextFusion.expirationHeight) return null;

  const heightDiff = nextFusion.expirationHeight - currentHeight;
  const msRemaining = heightDiff * SECONDS_PER_MOMENTUM * 1000;

  return new Date(Date.now() + msRemaining);
}
