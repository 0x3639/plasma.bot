/**
 * One-time database migration: prepare MongoDB indexes.
 *
 * Runs automatically during deployment (inside Docker container).
 * Safe to run multiple times — skips steps already done.
 *
 * Manual usage: node scripts/migrate-indexes.mjs
 */
import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/plasma-bot';

async function main() {
  const safeUri = MONGODB_URI.replace(/\/\/.*@/, '//***@');
  console.log(`Connecting to ${safeUri}...`);
  await mongoose.connect(MONGODB_URI);
  console.log('Connected.\n');

  const db = mongoose.connection.db;
  const fusions = db.collection('fusions');
  const fuserequests = db.collection('fuserequests');

  // Step 1: Check for duplicate txHash values
  console.log('Step 1: Checking for duplicate txHash values...');
  const duplicates = await fusions.aggregate([
    { $group: { _id: '$txHash', count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
  ]).toArray();

  if (duplicates.length > 0) {
    console.error('\n  BLOCKING: Found duplicate txHash values:');
    for (const dup of duplicates) {
      console.error(`    txHash="${dup._id}" appears ${dup.count} times`);
    }
    console.error('\n  Fix manually before deploying.\n');
    await mongoose.disconnect();
    process.exit(1);
  }
  console.log('  OK — no duplicates.\n');

  // Step 2: Drop old plain fusionId_1 index if it exists
  console.log('Step 2: Checking for old fusionId_1 index...');
  const fusionIndexes = await fusions.indexes();
  const oldIndex = fusionIndexes.find(
    (idx) => idx.name === 'fusionId_1' && !idx.unique && !idx.partialFilterExpression
  );

  if (oldIndex) {
    console.log('  Dropping old plain fusionId_1 index...');
    await fusions.dropIndex('fusionId_1');
    console.log('  Dropped.\n');
  } else {
    console.log('  Not found (already migrated).\n');
  }

  // Step 3: Report current state
  console.log('Current fusions indexes:');
  for (const idx of await fusions.indexes()) {
    const flags = [
      idx.unique ? 'unique' : '',
      idx.partialFilterExpression ? 'partial' : '',
      idx.expireAfterSeconds ? `TTL:${idx.expireAfterSeconds}s` : '',
    ].filter(Boolean).join(', ');
    console.log(`  ${idx.name}: ${JSON.stringify(idx.key)}${flags ? ` (${flags})` : ''}`);
  }

  console.log('\nCurrent fuserequests indexes:');
  for (const idx of await fuserequests.indexes()) {
    const flags = [
      idx.unique ? 'unique' : '',
      idx.expireAfterSeconds ? `TTL:${idx.expireAfterSeconds}s` : '',
    ].filter(Boolean).join(', ');
    console.log(`  ${idx.name}: ${JSON.stringify(idx.key)}${flags ? ` (${flags})` : ''}`);
  }

  console.log('\nMigration complete.\n');
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('Migration failed:', err);
  await mongoose.disconnect();
  process.exit(1);
});
