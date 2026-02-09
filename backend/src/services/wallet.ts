import fs from 'node:fs';
import { KeyFile, type KeyStore, type KeyPair, type Address } from 'znn-typescript-sdk';
import { CONFIG } from '../config/index.js';
import { logger } from '../utils/logger.js';

let keyStore: KeyStore | null = null;
let keyPair: KeyPair | null = null;
let walletAddress: Address | null = null;

export async function initializeWallet(): Promise<void> {
  if (!CONFIG.KEYFILE_PATH || !CONFIG.KEYFILE_PASSWORD) {
    throw new Error('KEYFILE_PATH and KEYFILE_PASSWORD must be configured');
  }

  logger.info('Loading encrypted wallet keyfile', { path: CONFIG.KEYFILE_PATH });

  const keyfileJson = fs.readFileSync(CONFIG.KEYFILE_PATH, 'utf-8');
  const keyfileData = JSON.parse(keyfileJson);

  // Decrypt using SDK's KeyFile (Argon2id + AES-256-GCM)
  // KeyFile.setPassword() returns a KeyFile instance, .decrypt() returns KeyStore
  const kf = KeyFile.setPassword(CONFIG.KEYFILE_PASSWORD);
  keyStore = await kf.decrypt(keyfileData);

  keyPair = keyStore.getKeyPair(0);
  walletAddress = keyPair.getAddress();

  // Clear password from memory to minimize exposure window
  delete process.env.KEYFILE_PASSWORD;
  (CONFIG as Record<string, unknown>).KEYFILE_PASSWORD = '';

  logger.info('Wallet loaded successfully', {
    address: walletAddress.toString(),
  });
}

export function getKeyPair(): KeyPair {
  if (!keyPair) {
    throw new Error('Wallet not initialized. Call initializeWallet() first.');
  }
  return keyPair;
}

export function getWalletAddress(): Address {
  if (!walletAddress) {
    throw new Error('Wallet not initialized. Call initializeWallet() first.');
  }
  return walletAddress;
}
