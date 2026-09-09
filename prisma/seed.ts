/**
 * Seeds the fixed activity list. Activities are reference data, not
 * user-generated content, so they are safe to seed idempotently.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

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
