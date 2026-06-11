import { receiveAllPending } from '../services/receiveTx.js';
import { reconcileFusionIds, failStaleProcessingRequests } from './reconcile.js';
import { runUnfuseCycle } from '../services/unfuse.js';
import { CONFIG } from '../config/index.js';
import { logger } from '../utils/logger.js';

let intervalId: ReturnType<typeof setInterval> | null = null;
let isRunning = false;

async function runCycle(): Promise<void> {
  if (isRunning) return;
  isRunning = true;
  try {
    // Step 1: Receive any pending transactions
    try { await receiveAllPending(); }
    catch (error) { logger.error('Receive step failed', { error }); }

    // Step 2: Self-heal stranded per-address locks (DB-only, runs even when the
    // node is down so a stuck 'processing' record can't outlive node outages)
    try { await failStaleProcessingRequests(); }
    catch (error) { logger.error('Stale processing sweep failed', { error }); }

    // Step 3: Reconcile fusion IDs (also creates DB records for orphaned chain entries)
    try { await reconcileFusionIds(); }
    catch (error) { logger.error('Reconcile step failed', { error }); }

    // Step 4: Run unfuse cycle if balance is low
    try { await runUnfuseCycle(); }
    catch (error) { logger.error('Unfuse step failed', { error }); }
  } catch (error) {
    logger.error('Balance monitor cycle failed', { error });
  } finally {
    isRunning = false;
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
