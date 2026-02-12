/**
 * Database migration: add Telegram fields to FuseRequest documents.
 *
 * - Backfills existing records with source='web' and telegramUserId=null
 * - Creates the { telegramUserId: 1, createdAt: 1 } index
 *
 * Safe to run multiple times — skips records already migrated.
 * Plain JS for Docker compatibility (production image has no TypeScript).
 *
 * Manual usage: node scripts/add-telegram-fields.mjs
 */
import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/plasma-bot';

async function main() {
  const safeUri = MONGODB_URI.replace(/\/\/.*@/, '//***@');
  console.log(`Connecting to ${safeUri}...`);
  await mongoose.connect(MONGODB_URI);
  console.log('Connected.\n');

  const db = mongoose.connection.db;
  const fuserequests = db.collection('fuserequests');

  // Step 1: Backfill source='web' on records without a source field
  console.log('Step 1: Backfilling source field...');
  const sourceResult = await fuserequests.updateMany(
    { source: { $exists: false } },
    { $set: { source: 'web' } },
  );
  console.log(`  Updated ${sourceResult.modifiedCount} records.\n`);

  // Step 2: Backfill telegramUserId=null on records without it
  console.log('Step 2: Backfilling telegramUserId field...');
  const tgResult = await fuserequests.updateMany(
    { telegramUserId: { $exists: false } },
    { $set: { telegramUserId: null } },
  );
  console.log(`  Updated ${tgResult.modifiedCount} records.\n`);

  // Step 3: Create index for Telegram rate limiting
  console.log('Step 3: Ensuring telegramUserId + createdAt index...');
  await fuserequests.createIndex(
    { telegramUserId: 1, createdAt: 1 },
    { name: 'telegramUserId_1_createdAt_1', background: true },
  );
  console.log('  Index ready.\n');

  // Report
  console.log('Current fuserequests indexes:');
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
