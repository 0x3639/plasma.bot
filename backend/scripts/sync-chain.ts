/**
 * Sync on-chain fusion entries into the local database.
 * Run this when the DB is out of sync with what's actually on-chain.
 * Usage: npx tsx scripts/sync-chain.ts
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { Zenon } from 'znn-typescript-sdk';
import { CONFIG } from '../src/config/index.js';
import { Fusion } from '../src/models/Fusion.js';
import { initializeWallet, getWalletAddress } from '../src/services/wallet.js';
import { initializeZenon, getZenon } from '../src/services/zenon.js';

async function main() {
  // Connect to MongoDB
  await mongoose.connect(CONFIG.MONGODB_URI);
  console.log('Connected to MongoDB');

  // Initialize Zenon + wallet
  await initializeZenon();
  await initializeWallet();

  const zenon = getZenon();
  const walletAddress = getWalletAddress();

  console.log(`Wallet address: ${walletAddress.toString()}`);

  // Get on-chain fusion entries
  const chainEntries = await zenon.embedded.plasma.getEntriesByAddress(walletAddress);

  if (!chainEntries?.list || chainEntries.list.length === 0) {
    console.log('No on-chain fusion entries found.');
    await mongoose.disconnect();
    return;
  }

  console.log(`Found ${chainEntries.list.length} on-chain fusion entries:\n`);

  for (const entry of chainEntries.list) {
    const fusionId = entry.id.toString();
    const beneficiary = entry.beneficiary?.toString() || 'unknown';
    const qsrAmount = Number(entry.qsrAmount?.toString() || '0');
    const qsrHuman = qsrAmount / Math.pow(10, CONFIG.QSR_DECIMALS);
    const isRevocable = entry.isRevocable;

    console.log(`  FusionID: ${fusionId}`);
    console.log(`  Beneficiary: ${beneficiary}`);
    console.log(`  Amount: ${qsrHuman} QSR (${qsrAmount} base units)`);
    console.log(`  Revocable: ${isRevocable}`);

    // Check if already in DB
    const existing = await Fusion.findOne({ fusionId });
    if (existing) {
      console.log(`  DB Status: Already exists (status: ${existing.status})`);
    } else {
      // Determine tier from amount
      let tier: 'low' | 'medium' | 'high' = 'low';
      if (qsrHuman >= 120) tier = 'high';
      else if (qsrHuman >= 80) tier = 'medium';

      await Fusion.create({
        fusionId,
        beneficiary,
        tier,
        qsrAmount,
        txHash: fusionId, // Use fusionId as placeholder since we don't have the original tx hash
        status: 'active',
        fusedAt: new Date(), // We don't know the exact time, use now
      });
      console.log(`  DB Status: CREATED (tier: ${tier})`);
    }
    console.log('');
  }

  // Summary
  const dbCount = await Fusion.countDocuments({ status: 'active' });
  console.log(`Done. ${dbCount} active fusions in DB.`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
