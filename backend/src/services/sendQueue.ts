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

/**
 * Upper bound on jobs waiting for the queue. Every queued job admits a request
 * that has already taken a global-cap slot, an address lock and a QSR
 * reservation, and each job costs at least INTER_TX_DELAY_MS of wall-clock
 * time. Without a bound a large burst could keep valid jobs waiting longer than
 * the processing-lease window, so callers get a fast "busy" rejection instead.
 */
export const MAX_QUEUE_DEPTH = 50;

let queueDepth = 0;

export class SendQueueFullError extends Error {
  constructor() {
    super(`Send queue is full (${MAX_QUEUE_DEPTH} jobs waiting)`);
    this.name = 'SendQueueFullError';
  }
}

export interface SerializedSendOptions {
  /**
   * Runs inside the queue slot, immediately before the block is signed and
   * sent. If it throws, nothing is sent and the error propagates to the
   * caller. Used to revalidate that a queued job still owns its admission
   * (its 'processing' lease) after waiting in line.
   */
  beforeSend?: () => Promise<void> | void;
}

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

export function getSendQueueDepth(): number {
  return queueDepth;
}

export function serializedSend(
  block: AccountBlockTemplate,
  keyPair: KeyPair,
  options: SerializedSendOptions = {},
): Promise<unknown> {
  const zenon = getZenon();

  if (queueDepth >= MAX_QUEUE_DEPTH) {
    return Promise.reject(new SendQueueFullError());
  }
  queueDepth++;

  const next = lock.then(async () => {
    try {
      if (options.beforeSend) await options.beforeSend();
      const result = await withTimeout(zenon.send(block, keyPair), SEND_TIMEOUT_MS);
      await delay(INTER_TX_DELAY_MS);
      return result;
    } finally {
      queueDepth--;
    }
  });

  // Always reset lock to a resolved state so future calls aren't poisoned by errors
  lock = next.catch(() => undefined);

  return next;
}
