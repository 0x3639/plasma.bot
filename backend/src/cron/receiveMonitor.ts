import { receiveAllPending } from '../services/receiveTx.js';
import { CONFIG } from '../config/index.js';
import { logger } from '../utils/logger.js';

let intervalId: ReturnType<typeof setInterval> | null = null;

export function startReceiveMonitor(): void {
  logger.info(`Starting receive monitor (interval: ${CONFIG.RECEIVE_CHECK_INTERVAL_MS / 1000}s)`);

  intervalId = setInterval(async () => {
    try {
      await receiveAllPending();
    } catch (error) {
      logger.error('Receive monitor cycle failed', { error });
    }
  }, CONFIG.RECEIVE_CHECK_INTERVAL_MS);
}

export function stopReceiveMonitor(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    logger.info('Receive monitor stopped');
  }
}
