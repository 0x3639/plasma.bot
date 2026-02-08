import { AccountBlockTemplate } from 'znn-typescript-sdk';
import { getZenon } from './zenon.js';
import { getKeyPair, getWalletAddress } from './wallet.js';
import { serializedSend } from './sendQueue.js';
import { logger } from '../utils/logger.js';

/**
 * Receive all pending/unreceived transactions for the bot's wallet.
 * This is critical: cancelled fusions return QSR as unreceived blocks.
 */
export async function receiveAllPending(): Promise<number> {
  const zenon = getZenon();
  const keyPair = getKeyPair();
  const address = getWalletAddress();

  const unreceived = await zenon.ledger.getUnreceivedBlocksByAddress(address, 0, 50);

  if (!unreceived || !unreceived.list || unreceived.list.length === 0) {
    return 0;
  }

  let received = 0;

  for (const block of unreceived.list) {
    try {
      const receiveBlock = AccountBlockTemplate.receive(block.hash);
      await serializedSend(receiveBlock, keyPair);
      received++;
    } catch (error) {
      logger.error('Failed to receive block', {
        hash: block.hash?.toString(),
        error,
      });
    }
  }

  if (received > 0) {
    logger.info(`Received ${received} pending transactions`);
  }

  return received;
}
