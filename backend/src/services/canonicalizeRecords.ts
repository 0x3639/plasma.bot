import { Fusion } from '../models/Fusion.js';
import { FuseRequest } from '../models/FuseRequest.js';
import { logger } from '../utils/logger.js';

const NON_CANONICAL = /[A-Z]/;

interface CollectionResult {
  canonicalized: number;
  failedDuplicateLocks: number;
}

/**
 * Lowercase every non-canonical beneficiary in one collection.
 *
 * Bech32 accepts an all-uppercase encoding of the same address, and the
 * Telegram entry point used to store the caller's raw string, so `Z1...`
 * records diverged from the canonical `z1...` identity every per-address
 * check uses. A colliding active/pending Fusion is a real second on-chain
 * fusion (own fusionId, unfused independently) and is kept; a 'processing'
 * FuseRequest that would collide with another live lock for the canonical
 * address is marked 'failed' (the unique partial index forbids two live locks
 * and the record is a stale artefact of the old behaviour) and lowercased in
 * the same write, since the index no longer applies to a failed record.
 */
async function canonicalizeCollection(
  collection: typeof FuseRequest.collection | typeof Fusion.collection,
): Promise<CollectionResult> {
  const result: CollectionResult = { canonicalized: 0, failedDuplicateLocks: 0 };
  const cursor = collection.find(
    { beneficiary: NON_CANONICAL },
    { projection: { beneficiary: 1, status: 1 } },
  );

  for await (const doc of cursor) {
    const canonical = String(doc.beneficiary).toLowerCase();
    try {
      await collection.updateOne({ _id: doc._id }, { $set: { beneficiary: canonical } });
      result.canonicalized++;
    } catch (error) {
      const code = (error as { code?: number }).code;
      if (code === 11000 && doc.status === 'processing') {
        await collection.updateOne(
          { _id: doc._id },
          { $set: { beneficiary: canonical, status: 'failed', errorMessage: 'Superseded duplicate processing lock (address canonicalization)' } },
        );
        result.failedDuplicateLocks++;
      } else {
        throw error;
      }
    }
  }

  return result;
}

/**
 * Canonicalize stored beneficiary addresses. Idempotent; run at every startup
 * BEFORE any entry point is served.
 *
 * The deploy pipeline also runs this as a migration, but the previous backend
 * container keeps serving (with the old, non-canonicalizing code) until the
 * new one replaces it, so a record written in that window would survive a
 * migration-only fix. Running here closes that race: whatever the old writer
 * left behind is normalized before this process accepts its first request.
 */
export async function canonicalizeStoredAddresses(): Promise<void> {
  const requests = await canonicalizeCollection(FuseRequest.collection);
  const fusions = await canonicalizeCollection(Fusion.collection);

  const total = requests.canonicalized + fusions.canonicalized;
  if (total > 0 || requests.failedDuplicateLocks > 0) {
    logger.warn('Canonicalized non-canonical beneficiary addresses', {
      fuseRequests: requests.canonicalized,
      fusions: fusions.canonicalized,
      failedDuplicateLocks: requests.failedDuplicateLocks,
    });
  }
}
