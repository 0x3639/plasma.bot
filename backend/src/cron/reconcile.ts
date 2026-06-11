import { CONFIG } from '../config/index.js';
import { Fusion } from '../models/Fusion.js';
import { FuseRequest } from '../models/FuseRequest.js';
import { getAllFusionEntries } from '../services/plasma.js';
import { logger } from '../utils/logger.js';

// Grace period before a still-unconfirmed 'pending' fusion is considered failed.
// Generously larger than momentum production time (~10s) to avoid failing a fuse
// that simply hasn't been produced yet.
const STALE_PENDING_MS = 10 * 60 * 1000; // 10 minutes

// Grace period before an in-flight 'processing' FuseRequest is considered
// abandoned. A healthy request finishes in well under a minute (send timeout is
// 30s); anything older means the handler died (crash, unhandled error) without
// transitioning the record.
const STALE_PROCESSING_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Fail stale 'processing' FuseRequests.
 *
 * The 'processing' record doubles as the per-address mutex (unique partial
 * index) and occupies a global-cap slot, so a record stranded by a crash or an
 * unhandled error would otherwise block its address until the 90-day TTL.
 * This sweeper makes that lock self-healing.
 */
export async function failStaleProcessingRequests(): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_PROCESSING_MS);
  const result = await FuseRequest.updateMany(
    { status: 'processing', createdAt: { $lt: cutoff } },
    { $set: { status: 'failed', errorMessage: 'Stale processing request (handler never completed)' } },
  );

  if (result.modifiedCount > 0) {
    logger.warn(`Failed ${result.modifiedCount} stale 'processing' fuse request(s)`);
  }
}

/**
 * Reconcile fusion IDs.
 * After zenon.send() for a fuse, we have the txHash but not the on-chain FusionEntry.id.
 * This function queries chain entries and matches them to our DB records.
 *
 * Also detects "orphaned" chain entries (fusions on-chain with no DB record)
 * and creates DB records for them so they can be managed by the unfuse cycle.
 */
export async function reconcileFusionIds(): Promise<void> {
  // Full, paginated list — absence from it is treated as meaningful below
  // (stale-pending failure), so a partial single page would misclassify
  // entries beyond it. getAllFusionEntries throws rather than return partial.
  const entryList = await getAllFusionEntries();

  // Build a set of already-used fusion IDs from the DB
  const usedFusionIds = new Set<string>();
  const allDbFusions = await Fusion.find({ fusionId: { $ne: null } }).select('fusionId').exec();
  for (const f of allDbFusions) {
    if (f.fusionId) usedFusionIds.add(f.fusionId);
  }

  // Step 1: Reconcile DB records that have fusionId: null.
  // Includes 'pending' (sent, not yet confirmed) and legacy 'active' records.
  // Processed oldest-first (FIFO) so that when multiple records share the same
  // (beneficiary, amount) we bind each DB record to the oldest matching chain
  // entry — preventing a record from being bound to a newer fusion and later
  // cancelling the wrong one.
  const unreconciled = await Fusion.find({
    fusionId: null,
    status: { $in: ['pending', 'active'] },
  })
    .sort({ fusedAt: 1 })
    .exec();

  let reconciled = 0;

  for (const dbFusion of unreconciled) {
    // Gather all chain entries matching this record's (beneficiary, amount),
    // then pick the oldest unused one (smallest expirationHeight) for a stable,
    // FIFO-aligned binding.
    const candidates = entryList
      .filter((entry) => {
        const entryId = entry.id.toString();
        if (usedFusionIds.has(entryId)) return false;
        const entryBeneficiary = entry.beneficiary?.toString();
        const entryAmount = Number(entry.qsrAmount?.toString() || '0');
        return entryBeneficiary === dbFusion.beneficiary && entryAmount === dbFusion.qsrAmount;
      })
      .sort((a, b) => Number(a.expirationHeight || 0) - Number(b.expirationHeight || 0));

    const match = candidates[0];
    if (match) {
      const entryId = match.id.toString();
      dbFusion.fusionId = entryId;
      dbFusion.expirationHeight = Number(match.expirationHeight || 0);
      dbFusion.status = 'active'; // confirmed on-chain — promote pending -> active
      await dbFusion.save();
      usedFusionIds.add(entryId);
      reconciled++;
    }
  }

  if (reconciled > 0) {
    logger.info(`Reconciled ${reconciled} fusion IDs`);
  }

  // Step 2: Backfill expirationHeight on fusions that have fusionId but missing expirationHeight
  // (happens when older code reconciled fusionId without setting expirationHeight)
  const chainEntryMap = new Map<string, number>();
  for (const entry of entryList) {
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

  for (const entry of entryList) {
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

  // Step 4: Fail stale 'pending' fusions. A pending record older than the grace
  // window that still has no matching chain entry means the fuse never landed
  // (e.g. rejected for insufficient QSR). Marking it 'failed' frees the address
  // instead of blocking it forever. Absence is meaningful here: the chain query
  // succeeded (getAllFusionEntries throws otherwise) and covered every page —
  // an empty list just means the wallet currently has no entries at all.
  const staleCutoff = new Date(Date.now() - STALE_PENDING_MS);
  const stalePending = await Fusion.find({
    status: 'pending',
    fusionId: null,
    fusedAt: { $lt: staleCutoff },
  }).exec();

  let failedStale = 0;
  for (const fusion of stalePending) {
    fusion.status = 'failed';
    await fusion.save();
    failedStale++;
    logger.warn(`Failed stale pending fusion (no chain entry after grace period)`, {
      id: fusion._id.toString(),
      beneficiary: fusion.beneficiary,
      txHash: fusion.txHash,
    });
  }

  if (failedStale > 0) {
    logger.warn(`Failed ${failedStale} stale pending fusion(s)`);
  }
}
