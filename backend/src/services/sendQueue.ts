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
// The beforeSend hook is a single MongoDB round trip (lease refresh); bound it
// so a slow database cannot stretch a job past the worst case assumed below.
const BEFORE_SEND_TIMEOUT_MS = 5_000;

/**
 * Upper bound on jobs waiting for the queue. Every queued job admits a request
 * that has already taken a global-cap slot, an address lock and a QSR
 * reservation. The bound is sized against the WORST-case per-job cost
 * (BEFORE_SEND_TIMEOUT_MS + SEND_TIMEOUT_MS + INTER_TX_DELAY_MS = 37s) so that
 * even a queue full of timing-out jobs drains inside the 10-minute processing
 * lease (15 x 37s = 9.25 min): a job that is admitted always reaches its send
 * slot with its lease still valid, and callers beyond the bound get a fast
 * "busy" rejection instead of holding resources they can never use. In normal
 * operation a job costs ~3s, so the bound represents well under a minute.
 */
export const MAX_QUEUE_DEPTH = 15;

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
  /**
   * Wallet-maintenance jobs (receiving pending blocks, unfusing to reclaim
   * QSR) are exempt from MAX_QUEUE_DEPTH. Public fuse traffic alone can fill
   * the bounded queue; without this lane it could starve the very work that
   * restores the wallet's capacity. Maintenance callers are already bounded
   * by their own cycles, so they cannot grow the queue without limit.
   */
  priority?: boolean;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise.then(
      (v) => { clearTimeout(timer); return v; },
      (e) => { clearTimeout(timer); throw e; },
    ),
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

  if (!options.priority && queueDepth >= MAX_QUEUE_DEPTH) {
    return Promise.reject(new SendQueueFullError());
  }
  queueDepth++;

  const next = lock.then(async () => {
    try {
      if (options.beforeSend) {
        await withTimeout(Promise.resolve(options.beforeSend()), BEFORE_SEND_TIMEOUT_MS);
      }
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
