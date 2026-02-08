import type { AccountBlockTemplate, KeyPair } from 'znn-typescript-sdk';
import { getZenon } from './zenon.js';
import { logger } from '../utils/logger.js';

/**
 * Serialized transaction queue.
 * Zenon requires sequential account blocks (each references the previous frontier).
 * This mutex ensures only one zenon.send() runs at a time.
 */
let lock = Promise.resolve<unknown>(undefined);

export function serializedSend(
  block: AccountBlockTemplate,
  keyPair: KeyPair,
): Promise<unknown> {
  const zenon = getZenon();

  lock = lock
    .then(() => zenon.send(block, keyPair))
    .catch((error) => {
      logger.error('Transaction failed in send queue', { error });
      throw error;
    });

  return lock;
}
