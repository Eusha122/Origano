import { createDb } from '../db/client';
import { seedZones } from './seed';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}
const { db, close } = createDb(url);
try {
  await seedZones(db);
  console.log('zones seeded');
} finally {
  await close();
}
