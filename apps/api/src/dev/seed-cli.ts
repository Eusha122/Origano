import { createDb } from '../db/client';
import { seedZones } from '../zones/seed';

// Zones only: safe on any database. Demo users and the demo restaurant come from `pnpm db:seed:demo`.
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
