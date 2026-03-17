import { AccountBlockTemplate } from 'znn-typescript-sdk';
import { getZenon } from './zenon.js';
import { getKeyPair, getWalletAddress } from './wallet.js';
import { serializedSend } from './sendQueue.js';
import { logger } from '../utils/logger.js';

const PAGE_SIZE = 50;
const MAX_PAGES = 20; // Safety cap: 1000 blocks max per cycle

/**
 * Receive all pending/unreceived transactions for the bot's wallet.
 * This is critical: cancelled fusions return QSR as unreceived blocks.
 *
 * Uses pagination to handle >50 unreceived blocks (e.g. after node downtime).
 * Always fetches page 0 because received blocks disappear from the list.
 */
export async function receiveAllPending(): Promise<number> {
  const zenon = getZenon();
  const keyPair = getKeyPair();
  const address = getWalletAddress();

  let received = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const unreceived = await zenon.ledger.getUnreceivedBlocksByAddress(address, 0, PAGE_SIZE);

    if (!unreceived || !unreceived.list || unreceived.list.length === 0) {
      break;
    }

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

    // If we got fewer than PAGE_SIZE, there are no more pages
    if (unreceived.list.length < PAGE_SIZE) {
      break;
    }
  }

  if (received >= MAX_PAGES * PAGE_SIZE) {
    logger.warn(`Unreceived block pagination hit safety cap (${MAX_PAGES} pages). Some blocks may remain unprocessed.`);
  }

  if (received > 0) {
    logger.info(`Received ${received} pending transactions`);
  }

  return received;
}
