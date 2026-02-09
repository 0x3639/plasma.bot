/**
 * Change the password on an encrypted wallet keyfile.
 * Usage: npx tsx scripts/change-password.ts [keyfile-path]
 *
 * Defaults to ./dev-wallet.json if no path is provided.
 * Decrypts with the old password, re-encrypts with a new one,
 * and verifies the result before overwriting.
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { KeyFile } from 'znn-typescript-sdk';

function prompt(question: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    if (hidden && process.stdin.isTTY) {
      process.stdout.write(question);
      const stdin = process.stdin;
      stdin.setRawMode(true);
      stdin.resume();
      stdin.setEncoding('utf8');

      let input = '';
      const onData = (ch: string) => {
        if (ch === '\n' || ch === '\r' || ch === '\u0004') {
          stdin.setRawMode(false);
          stdin.removeListener('data', onData);
          rl.close();
          process.stdout.write('\n');
          resolve(input);
        } else if (ch === '\u0003') {
          process.exit(130);
        } else if (ch === '\u007F' || ch === '\b') {
          input = input.slice(0, -1);
        } else {
          input += ch;
        }
      };
      stdin.on('data', onData);
    } else {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer);
      });
    }
  });
}

async function main() {
  const keyfilePath = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(import.meta.dirname, '..', 'dev-wallet.json');

  if (!fs.existsSync(keyfilePath)) {
    console.error(`Keyfile not found: ${keyfilePath}`);
    process.exit(1);
  }

  console.log(`Keyfile: ${keyfilePath}\n`);

  const oldPassword = await prompt('Current password: ', true);
  if (!oldPassword) {
    console.error('Password cannot be empty.');
    process.exit(1);
  }

  // Decrypt with old password
  console.log('Decrypting...');
  const keyfileData = JSON.parse(fs.readFileSync(keyfilePath, 'utf-8'));

  let keyStore;
  try {
    const kf = KeyFile.setPassword(oldPassword);
    keyStore = await kf.decrypt(keyfileData);
  } catch {
    console.error('Failed to decrypt. Wrong password?');
    process.exit(1);
  }

  const address = keyStore.getBaseAddress().toString();
  console.log(`Decrypted OK. Address: ${address}\n`);

  // Get new password
  const newPassword = await prompt('New password: ', true);
  if (!newPassword) {
    console.error('New password cannot be empty.');
    process.exit(1);
  }

  const confirmPassword = await prompt('Confirm new password: ', true);
  if (newPassword !== confirmPassword) {
    console.error('Passwords do not match.');
    process.exit(1);
  }

  // Re-encrypt with new password
  console.log('\nEncrypting with new password...');
  const newKf = KeyFile.setPassword(newPassword);
  const encryptedData = await newKf.encrypt(keyStore);

  // Verify before overwriting
  console.log('Verifying...');
  const verifyKf = KeyFile.setPassword(newPassword);
  const decrypted = await verifyKf.decrypt(encryptedData);
  const verifyAddress = decrypted.getBaseAddress().toString();

  if (verifyAddress !== address) {
    console.error('Verification FAILED -- addresses do not match! File not overwritten.');
    process.exit(1);
  }

  // Write to disk
  fs.writeFileSync(keyfilePath, JSON.stringify(encryptedData, null, 2));
  console.log(`\nPassword changed successfully.`);
  console.log(`Keyfile updated: ${keyfilePath}`);
  console.log(`\nRemember to update KEYFILE_PASSWORD in your .env file.`);
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
