import type { AccountBlockTemplate, KeyPair } from 'znn-typescript-sdk';
import { getZenon } from './zenon.js';

/**
 * Serialized transaction queue.
 * Zenon requires sequential account blocks (each references the previous frontier).
 * This mutex ensures only one zenon.send() runs at a time, with a small delay
 * between transactions to let the node update the account frontier.
 */
let lock = Promise.resolve<unknown>(undefined);

const INTER_TX_DELAY_MS = 2000;
const SEND_TIMEOUT_MS = 30_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise.then((v) => { clearTimeout(timer); return v; }),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Send timeout after ${ms}ms`)), ms);
    }),
  ]);
}

export function serializedSend(
  block: AccountBlockTemplate,
  keyPair: KeyPair,
): Promise<unknown> {
  const zenon = getZenon();

  const next = lock.then(async () => {
    const result = await withTimeout(zenon.send(block, keyPair), SEND_TIMEOUT_MS);
    await delay(INTER_TX_DELAY_MS);
    return result;
  });

  // Always reset lock to a resolved state so future calls aren't poisoned by errors
  lock = next.catch(() => undefined);

  return next;
}
