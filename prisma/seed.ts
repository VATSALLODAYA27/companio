/**
 * Seeds the fixed activity list. Activities are reference data, not
 * user-generated content, so they are safe to seed idempotently.
 */
// This script runs standalone via `ts-node` (see package.json's
// prisma:seed script), not through the Nest app or the Prisma CLI — so
// nothing else loads `.env` into process.env before the DATABASE_URL
// read below. Same root cause/fix as prisma.config.ts's own
// `import 'dotenv/config'` — see the comment there for the full
// explanation. Without this line, `npm run prisma:seed` fails with
// "Error: DATABASE_URL is not set" even with a correctly filled-in
// `.env` present.
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// Same WASM-engine + driver-adapter construction as PrismaService — see
// ARCHITECTURE.md "Prisma engine strategy". DATABASE_URL is read
// directly here (not via ConfigService) since this script runs outside
// the Nest DI container.
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is not set');
}
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const ACTIVITIES: Array<{ key: string; label: string }> = [
  { key: 'trekking', label: 'Trekking' },
  { key: 'bowling', label: 'Bowling' },
  { key: 'gym', label: 'Gym' },
  { key: 'running', label: 'Running' },
  { key: 'badminton', label: 'Badminton' },
  { key: 'cricket', label: 'Cricket' },
  { key: 'football', label: 'Football' },
  { key: 'cycling', label: 'Cycling' },
  { key: 'photography', label: 'Photography' },
  { key: 'hiking', label: 'Hiking' },
  { key: 'swimming', label: 'Swimming' },
  { key: 'cafe_hopping', label: 'Café hopping' },
];

async function main() {
  for (const activity of ACTIVITIES) {
    await prisma.activity.upsert({
      where: { key: activity.key },
      update: { label: activity.label },
      create: activity,
    });
  }
  // eslint-disable-next-line no-console
  console.log(`Seeded ${ACTIVITIES.length} activities.`);
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
