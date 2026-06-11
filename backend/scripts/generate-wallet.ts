/**
 * Generate a new wallet keyfile for development/testing.
 * Usage: npx tsx scripts/generate-wallet.ts
 *
 * This creates an encrypted keyfile at ./dev-wallet.json
 * and prints the wallet address and mnemonic (SAVE THE MNEMONIC!).
 */
import fs from 'node:fs';
import path from 'node:path';
import { KeyStore, KeyFile } from 'znn-typescript-sdk';

// The keyfile password must NOT be hardcoded — a committed password gives the
// keyfile's encryption zero value (anyone with the repo + keyfile can decrypt
// it and recover the private key). Supply it at runtime:
//   KEYFILE_PASSWORD='<strong-password>' npx tsx scripts/generate-wallet.ts
const PASSWORD = process.env.KEYFILE_PASSWORD;
const OUTPUT_PATH = path.join(import.meta.dirname, '..', 'dev-wallet.json');

const WEAK_PASSWORDS = new Set(['', 'dev-password-do-not-use-in-production', 'password', 'changeme']);

async function main() {
  if (!PASSWORD || WEAK_PASSWORDS.has(PASSWORD)) {
    console.error(
      'Refusing to generate a wallet without a strong KEYFILE_PASSWORD.\n' +
      "Run with: KEYFILE_PASSWORD='<strong-password>' npx tsx scripts/generate-wallet.ts",
    );
    process.exit(1);
  }

  console.log('Generating new wallet...\n');

  // Generate a new random wallet
  const keyStore = KeyStore.newRandom();

  const mnemonic = keyStore.mnemonic;
  const address = keyStore.getBaseAddress().toString();

  console.log('='.repeat(60));
  console.log('WALLET GENERATED — SAVE THIS INFORMATION');
  console.log('='.repeat(60));
  console.log(`Address:  ${address}`);
  console.log(`Mnemonic: ${mnemonic}`);
  console.log('='.repeat(60));
  console.log('');

  // Encrypt to keyfile
  const keyFile = KeyFile.setPassword(PASSWORD);
  const encryptedData = await keyFile.encrypt(keyStore);

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(encryptedData, null, 2));
  console.log(`Keyfile written to: ${OUTPUT_PATH}`);
  console.log(`Password: ${PASSWORD}`);
  console.log('');

  // Verify it can be decrypted
  const verifyKf = KeyFile.setPassword(PASSWORD);
  const verifyData = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf-8'));
  const decrypted = await verifyKf.decrypt(verifyData);
  const verifyAddress = decrypted.getBaseAddress().toString();

  if (verifyAddress === address) {
    console.log('Verification: OK — keyfile decrypts correctly');
  } else {
    console.error('Verification: FAILED — addresses do not match!');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
