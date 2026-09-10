import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

// Used by the Prisma CLI (generate/migrate/studio) only — the running
// application never reads this file. It gets DATABASE_URL from the
// environment the same way the API does; see apps/api/src/prisma/prisma.service.ts
// for the runtime connection (constructed via @prisma/adapter-pg).
//
// `import 'dotenv/config'` above loads `.env` from the current working
// directory into process.env *before* `env('DATABASE_URL')` below
// resolves it — prisma/config's `env()` reads process.env directly and
// does NOT load .env itself. Without this line, `npm run prisma:generate`
// / `prisma:migrate` fail with "PrismaConfigEnvError: Cannot resolve
// environment variable: DATABASE_URL" even with a correctly filled-in
// .env present, because nothing had loaded it into the process yet — the
// running NestJS app doesn't hit this (that's `@nestjs/config`'s
// ConfigModule.forRoot() loading .env separately, at app bootstrap), but
// the bare Prisma CLI has no equivalent step of its own.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: { url: env('DATABASE_URL') },
});
