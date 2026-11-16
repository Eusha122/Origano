import { createDb } from '../db/client';
import { seedDemo } from './seed-demo';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}
const { db, close } = createDb(url);
try {
  await seedDemo(db);
  console.log('demo data seeded');
} finally {
  await close();
}
