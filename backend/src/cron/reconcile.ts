import { getZenon } from '../services/zenon.js';
import { getWalletAddress } from '../services/wallet.js';
import { CONFIG } from '../config/index.js';
import { Fusion } from '../models/Fusion.js';
import { logger } from '../utils/logger.js';

/**
 * Reconcile fusion IDs.
 * After zenon.send() for a fuse, we have the txHash but not the on-chain FusionEntry.id.
 * This function queries chain entries and matches them to our DB records.
 *
 * Also detects "orphaned" chain entries (fusions on-chain with no DB record)
 * and creates DB records for them so they can be managed by the unfuse cycle.
 */
export async function reconcileFusionIds(): Promise<void> {
  const zenon = getZenon();
  const walletAddress = getWalletAddress();

  const chainEntries = await zenon.embedded.plasma.getEntriesByAddress(walletAddress);

  if (!chainEntries?.list || chainEntries.list.length === 0) {
    return;
  }

  // Build a set of already-used fusion IDs from the DB
  const usedFusionIds = new Set<string>();
  const allDbFusions = await Fusion.find({ fusionId: { $ne: null } }).select('fusionId').exec();
  for (const f of allDbFusions) {
    if (f.fusionId) usedFusionIds.add(f.fusionId);
  }

  // Step 1: Reconcile existing DB records that have fusionId: null
  const unreconciled = await Fusion.find({
    fusionId: null,
    status: 'active',
  }).exec();

  let reconciled = 0;

  for (const dbFusion of unreconciled) {
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

  // Step 2: Backfill expirationHeight on fusions that have fusionId but missing expirationHeight
  // (happens when older code reconciled fusionId without setting expirationHeight)
  const chainEntryMap = new Map<string, number>();
  for (const entry of chainEntries.list) {
    const expHeight = Number(entry.expirationHeight || 0);
    if (expHeight > 0) {
      chainEntryMap.set(entry.id.toString(), expHeight);
    }
  }

  const missingExpHeight = await Fusion.find({
    status: 'active',
    fusionId: { $ne: null },
    expirationHeight: null,
  }).exec();

  for (const fusion of missingExpHeight) {
    const expHeight = chainEntryMap.get(fusion.fusionId!);
    if (expHeight) {
      fusion.expirationHeight = expHeight;
      await fusion.save();
      logger.info(`Backfilled expirationHeight ${expHeight} for fusion ${fusion.fusionId}`);
    }
  }

  // Step 3: Detect orphaned chain entries (on-chain but no DB record at all)
  // This handles cases where the chain send succeeded but DB write failed,
  // or the database was out of sync.
  let orphaned = 0;

  for (const entry of chainEntries.list) {
    const entryId = entry.id.toString();

    if (usedFusionIds.has(entryId)) continue;

    const beneficiary = entry.beneficiary?.toString() || 'unknown';
    const qsrAmount = Number(entry.qsrAmount?.toString() || '0');
    const expirationHeight = Number(entry.expirationHeight || 0);

    // Also check if there's already a DB record matched by txHash (sync-chain may have created one)
    const existingByTx = await Fusion.findOne({
      $or: [{ fusionId: entryId }, { txHash: entryId }],
    }).exec();

    if (existingByTx) {
      // Backfill fusionId if missing
      if (!existingByTx.fusionId) {
        existingByTx.fusionId = entryId;
        existingByTx.expirationHeight = expirationHeight;
        await existingByTx.save();
        usedFusionIds.add(entryId);
        reconciled++;
      }
      continue;
    }

    // Determine tier from amount
    const qsrHuman = qsrAmount / Math.pow(10, CONFIG.QSR_DECIMALS);
    let tier: 'low' | 'medium' | 'high' = 'low';
    if (qsrHuman >= 120) tier = 'high';
    else if (qsrHuman >= 80) tier = 'medium';

    await Fusion.create({
      fusionId: entryId,
      expirationHeight,
      beneficiary,
      tier,
      qsrAmount,
      txHash: entryId,
      status: 'active',
      fusedAt: new Date(),
    });

    usedFusionIds.add(entryId);
    orphaned++;

    logger.warn(`Created DB record for orphaned chain entry: ${entryId} (${beneficiary}, ${qsrHuman} QSR)`);
  }

  if (orphaned > 0) {
    logger.warn(`Created ${orphaned} DB record(s) for orphaned chain entries`);
  }
}
