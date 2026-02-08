import { receiveAllPending } from '../services/receiveTx.js';
import { reconcileFusionIds } from './reconcile.js';
import { runUnfuseCycle } from '../services/unfuse.js';
import { CONFIG } from '../config/index.js';
import { logger } from '../utils/logger.js';

let intervalId: ReturnType<typeof setInterval> | null = null;

async function runCycle(): Promise<void> {
  try {
    // Step 1: Receive any pending transactions
    await receiveAllPending();

    // Step 2: Reconcile fusion IDs
    await reconcileFusionIds();

    // Step 3: Run unfuse cycle if balance is low
    await runUnfuseCycle();
  } catch (error) {
    logger.error('Balance monitor cycle failed', { error });
  }
}

export function startBalanceMonitor(): void {
  logger.info(`Starting balance monitor (interval: ${CONFIG.BALANCE_CHECK_INTERVAL_MS / 1000}s)`);

  // Run immediately on start
  runCycle();

  intervalId = setInterval(runCycle, CONFIG.BALANCE_CHECK_INTERVAL_MS);
}

export function stopBalanceMonitor(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    logger.info('Balance monitor stopped');
  }
}
