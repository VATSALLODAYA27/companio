import { defineConfig, env } from 'prisma/config';

// Used by the Prisma CLI (generate/migrate/studio) only — the running
// application never reads this file. It gets DATABASE_URL from the
// environment the same way the API does; see apps/api/src/prisma/prisma.service.ts
// for the runtime connection (constructed via @prisma/adapter-pg).
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: { url: env('DATABASE_URL') },
});
