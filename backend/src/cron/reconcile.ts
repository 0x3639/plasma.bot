import { getZenon } from '../services/zenon.js';
import { getWalletAddress } from '../services/wallet.js';
import { Fusion } from '../models/Fusion.js';
import { logger } from '../utils/logger.js';

/**
 * Reconcile fusion IDs.
 * After zenon.send() for a fuse, we have the txHash but not the on-chain FusionEntry.id.
 * This function queries chain entries and matches them to our DB records.
 */
export async function reconcileFusionIds(): Promise<void> {
  // Find fusions that haven't been reconciled yet
  const unreconciled = await Fusion.find({
    fusionId: null,
    status: 'active',
  }).exec();

  if (unreconciled.length === 0) {
    return;
  }

  const zenon = getZenon();
  const walletAddress = getWalletAddress();

  const chainEntries = await zenon.embedded.plasma.getEntriesByAddress(walletAddress);

  if (!chainEntries?.list) {
    return;
  }

  // Build a set of already-used fusion IDs from the DB
  const usedFusionIds = new Set<string>();
  const existingFusions = await Fusion.find({ fusionId: { $ne: null } }).select('fusionId').exec();
  for (const f of existingFusions) {
    if (f.fusionId) usedFusionIds.add(f.fusionId);
  }

  let reconciled = 0;

  for (const dbFusion of unreconciled) {
    // Try to match by beneficiary address and amount
    for (const entry of chainEntries.list) {
      const entryId = entry.id.toString();

      if (usedFusionIds.has(entryId)) continue;

      const entryBeneficiary = entry.beneficiary?.toString();
      const entryAmount = Number(entry.qsrAmount?.toString() || '0');

      if (entryBeneficiary === dbFusion.beneficiary && entryAmount === dbFusion.qsrAmount) {
        dbFusion.fusionId = entryId;
        dbFusion.expirationHeight = Number(entry.expirationHeight || 0);
        await dbFusion.save();
        usedFusionIds.add(entryId);
        reconciled++;
        break;
      }
    }
  }

  if (reconciled > 0) {
    logger.info(`Reconciled ${reconciled} fusion IDs`);
  }
}
