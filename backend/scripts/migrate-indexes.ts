/**
 * One-time migration: prepare MongoDB indexes for security audit changes.
 *
 * Run BEFORE deploying the new code to production:
 *   cd backend && npx tsx scripts/migrate-indexes.ts
 *
 * What this does:
 *   1. Checks for duplicate txHash values (blocks if found)
 *   2. Drops the old plain fusionId_1 index so the new unique partial index can be created
 *   3. Reports status of all indexes
 *
 * Safe to run multiple times — it skips steps that are already done.
 */
import 'dotenv/config';
import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/plasma-bot';

async function main() {
  console.log(`Connecting to ${MONGODB_URI.replace(/\/\/.*@/, '//***@')}...\n`);
  await mongoose.connect(MONGODB_URI);

  const db = mongoose.connection.db!;
  const fusions = db.collection('fusions');
  const fuserequests = db.collection('fuserequests');

  // Step 1: Check for duplicate txHash values
  console.log('Step 1: Checking for duplicate txHash values in fusions...');
  const duplicates = await fusions.aggregate([
    { $group: { _id: '$txHash', count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
  ]).toArray();

  if (duplicates.length > 0) {
    console.error('\n  BLOCKING: Found duplicate txHash values:');
    for (const dup of duplicates) {
      console.error(`    txHash="${dup._id}" appears ${dup.count} times`);
    }
    console.error('\n  Fix these manually before deploying. The new unique txHash index will fail otherwise.');
    console.error('  To find them: db.fusions.find({ txHash: "<value>" })\n');
    await mongoose.disconnect();
    process.exit(1);
  }
  console.log('  OK -- no duplicate txHash values found.\n');

  // Step 2: Drop old plain fusionId_1 index if it exists
  console.log('Step 2: Checking for old fusionId_1 index...');
  const fusionIndexes = await fusions.indexes();
  const oldFusionIdIndex = fusionIndexes.find(
    (idx) => idx.name === 'fusionId_1' && !idx.unique && !idx.partialFilterExpression
  );

  if (oldFusionIdIndex) {
    console.log('  Found old plain fusionId_1 index. Dropping...');
    await fusions.dropIndex('fusionId_1');
    console.log('  Dropped successfully.\n');
  } else {
    console.log('  Old plain fusionId_1 index not found (already dropped or never existed).\n');
  }

  // Step 3: Report current index state
  console.log('Step 3: Current indexes on fusions:');
  const updatedFusionIndexes = await fusions.indexes();
  for (const idx of updatedFusionIndexes) {
    const flags = [
      idx.unique ? 'unique' : '',
      idx.sparse ? 'sparse' : '',
      idx.partialFilterExpression ? 'partial' : '',
      idx.expireAfterSeconds ? `TTL:${idx.expireAfterSeconds}s` : '',
    ].filter(Boolean).join(', ');
    console.log(`  ${idx.name}: ${JSON.stringify(idx.key)}${flags ? ` (${flags})` : ''}`);
  }

  console.log('\nCurrent indexes on fuserequests:');
  const frIndexes = await fuserequests.indexes();
  for (const idx of frIndexes) {
    const flags = [
      idx.unique ? 'unique' : '',
      idx.expireAfterSeconds ? `TTL:${idx.expireAfterSeconds}s` : '',
    ].filter(Boolean).join(', ');
    console.log(`  ${idx.name}: ${JSON.stringify(idx.key)}${flags ? ` (${flags})` : ''}`);
  }

  console.log('\nMigration complete. Safe to deploy the new code.');
  console.log('Mongoose will create the new indexes automatically on startup.\n');

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('Migration failed:', err);
  await mongoose.disconnect();
  process.exit(1);
});
