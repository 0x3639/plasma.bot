import { Zenon } from 'znn-typescript-sdk';
import { CONFIG } from '../config/index.js';
import { logger } from '../utils/logger.js';

let zenon: Zenon | null = null;

export async function initializeZenon(): Promise<Zenon> {
  zenon = Zenon.getInstance();

  logger.info('Connecting to Zenon node', { url: CONFIG.ZNN_NODE_URL });

  await zenon.initialize(CONFIG.ZNN_NODE_URL, 30000, {
    autoconnect: true,
    reconnect: true,
    reconnect_interval: 5000,
  });

  logger.info('Connected to Zenon node');

  return zenon;
}

export function getZenon(): Zenon {
  if (!zenon) {
    throw new Error('Zenon SDK not initialized. Call initializeZenon() first.');
  }
  return zenon;
}

export function clearZenonConnection(): void {
  if (zenon) {
    zenon.clearConnection();
    zenon = null;
    logger.info('Zenon connection closed');
  }
}
