import mongoose from 'mongoose';
import { beforeAll, afterEach, afterAll } from 'vitest';

beforeAll(async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI not set by globalSetup');
  // Each fork (test file) gets its own database to prevent cross-file data races
  await mongoose.connect(uri, { dbName: `test_${process.pid}` });
});

afterEach(async () => {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});
