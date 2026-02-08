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
    const expHeight = Number(entry.expirationHeight || 0);

    console.log(`  FusionID: ${fusionId}`);
    console.log(`  Beneficiary: ${beneficiary}`);
    console.log(`  Amount: ${qsrHuman} QSR (${qsrAmount} base units)`);
    console.log(`  ExpirationHeight: ${expHeight}`);

    // Check if already in DB
    const existing = await Fusion.findOne({ fusionId });
    if (existing) {
      // Update expirationHeight if missing
      if (!existing.expirationHeight && expHeight) {
        existing.expirationHeight = expHeight;
        await existing.save();
        console.log(`  DB Status: Updated expirationHeight to ${expHeight}`);
      } else {
        console.log(`  DB Status: Already exists (status: ${existing.status})`);
      }
    } else {
      // Determine tier from amount
      let tier: 'low' | 'medium' | 'high' = 'low';
      if (qsrHuman >= 120) tier = 'high';
      else if (qsrHuman >= 80) tier = 'medium';

      await Fusion.create({
        fusionId,
        expirationHeight: expHeight,
        beneficiary,
        tier,
        qsrAmount,
        txHash: fusionId,
        status: 'active',
        fusedAt: new Date(),
      });
      console.log(`  DB Status: CREATED (tier: ${tier})`);
    }
    console.log('');
  }

  // Check for stale DB records (active in DB but not on chain)
  const chainFusionIds = new Set(
    chainEntries.list.map((e: { id: { toString(): string } }) => e.id.toString()),
  );
  const chainBeneficiaries = new Map<string, number>();
  for (const entry of chainEntries.list) {
    const ben = entry.beneficiary?.toString() || '';
    const amt = Number(entry.qsrAmount?.toString() || '0');
    const key = `${ben}:${amt}`;
    chainBeneficiaries.set(key, (chainBeneficiaries.get(key) || 0) + 1);
  }

  const dbActive = await Fusion.find({ status: 'active' });
  const dbBeneficiaries = new Map<string, typeof dbActive>();
  for (const doc of dbActive) {
    const key = `${doc.beneficiary}:${doc.qsrAmount}`;
    if (!dbBeneficiaries.has(key)) dbBeneficiaries.set(key, []);
    dbBeneficiaries.get(key)!.push(doc);
  }

  let staleCount = 0;
  for (const [key, docs] of dbBeneficiaries) {
    const chainCount = chainBeneficiaries.get(key) || 0;
    const excess = docs.length - chainCount;
    if (excess > 0) {
      // Mark the excess DB records (oldest first) as failed
      const sorted = docs.sort((a, b) => a.fusedAt.getTime() - b.fusedAt.getTime());
      for (let i = 0; i < excess; i++) {
        const doc = sorted[i];
        console.log(`  STALE: Marking fusion ${doc._id} as failed (${doc.beneficiary}, ${doc.qsrAmount / 1e8} QSR) — not found on chain`);
        doc.status = 'failed';
        await doc.save();
        staleCount++;
      }
    }
  }

  if (staleCount > 0) {
    console.log(`\nMarked ${staleCount} stale DB record(s) as failed.`);
  }

  // Summary
  const dbCount = await Fusion.countDocuments({ status: 'active' });
  console.log(`\nDone. ${dbCount} active fusions in DB.`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
