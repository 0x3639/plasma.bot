/**
 * Database migration: canonicalize beneficiary addresses.
 *
 * Bech32 accepts an all-uppercase encoding of the same address, and the
 * Telegram entry point used to store the caller's raw string. Records keyed by
 * `Z1...` therefore diverged from the canonical `z1...` identity that the
 * chain (and every other entry point) uses, so per-address checks could not
 * see them. This lowercases every non-canonical beneficiary in `fusions` and
 * `fuserequests`.
 *
 * Duplicate handling: an active/pending Fusion that collides after lowercasing
 * is a real second on-chain fusion for that address (each has its own fusionId
 * and is unfused independently), so both are kept. A 'processing' FuseRequest
 * that would collide with another 'processing' record for the canonical
 * address is marked 'failed' instead — the unique partial index forbids two
 * live locks and the record is a stale artefact of the old behaviour.
 *
 * Safe to run multiple times. Plain JS for Docker compatibility.
 *
 * Manual usage: node scripts/canonicalize-addresses.mjs
 */
import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/plasma-bot';
const NON_CANONICAL = /[A-Z]/;

async function canonicalizeCollection(collection, label) {
  const cursor = collection.find({ beneficiary: NON_CANONICAL }, { projection: { beneficiary: 1, status: 1 } });
  let updated = 0;
  let failedLocks = 0;

  for await (const doc of cursor) {
    const canonical = doc.beneficiary.toLowerCase();
    try {
      await collection.updateOne({ _id: doc._id }, { $set: { beneficiary: canonical } });
      updated++;
    } catch (error) {
      if (error && error.code === 11000 && doc.status === 'processing') {
        await collection.updateOne(
          { _id: doc._id },
          { $set: { status: 'failed', errorMessage: 'Superseded duplicate processing lock (address canonicalization)' } },
        );
        failedLocks++;
      } else {
        throw error;
      }
    }
  }

  console.log(`  ${label}: canonicalized ${updated} record(s)` + (failedLocks ? `, failed ${failedLocks} duplicate processing lock(s)` : ''));
}

async function main() {
  const safeUri = MONGODB_URI.replace(/\/\/.*@/, '//***@');
  console.log(`Connecting to ${safeUri}...`);
  await mongoose.connect(MONGODB_URI);
  console.log('Connected.\n');

  const db = mongoose.connection.db;

  console.log('Canonicalizing beneficiary addresses...');
  await canonicalizeCollection(db.collection('fuserequests'), 'fuserequests');
  await canonicalizeCollection(db.collection('fusions'), 'fusions');

  console.log('\nDone.');
  await mongoose.disconnect();
}

main().catch((error) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
