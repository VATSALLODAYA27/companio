# Companio API — production image (Phase 11)
#
# Build context is the REPO ROOT, not apps/api/ — this is an npm-workspaces
# monorepo (apps/api depends on packages/shared and the root
# package-lock.json), so apps/api cannot be built in isolation. Build with:
#
#   docker build -f apps/api/Dockerfile -t companio-api .
#
# (docker-compose.prod.yml does this automatically via `context: .`.)
#
# Two stages:
#   1. `build`   — full npm workspace install (incl. devDependencies),
#                  Prisma Client generation, and the TypeScript build for
#                  packages/shared + apps/api.
#   2. `runtime` — copies the ENTIRE /app directory from `build` wholesale,
#                  not a selective copy of node_modules/dist. This matters:
#                  npm workspaces are wired together with symlinks
#                  (node_modules/@companio/api -> ../../apps/api,
#                  node_modules/@companio/shared -> ../../packages/shared —
#                  see ARCHITECTURE.md "npm workspaces"), and selectively
#                  copying node_modules separately from apps/*|packages/*
#                  breaks those symlinks' relative targets.
#
# Deliberate scope decision: this image ships the full `build`-stage
# node_modules (including devDependencies, and dependencies pulled in for
# apps/web even though this image never runs it) rather than pruning to a
# production-only install. A leaner image is possible (a separate
# `npm ci --omit=dev` stage + copying just the generated Prisma client and
# compiled dist/ across stages) but that path fights two real footguns at
# once: `npm prune` can remove node_modules/.prisma/client as "extraneous"
# because it's generated output, not a package tracked in
# package-lock.json, and `prisma generate` itself needs the `prisma` CLI,
# which is a devDependency — so pruning removes the very tool needed to
# regenerate what pruning just deleted. Shipping the full node_modules
# sidesteps both problems at the cost of image size, which is an accepted
# tradeoff for this prototype (see SECURITY.md's priority order — this is a
# scalability/performance concern, ranked below security/privacy/
# correctness). Revisit with a proper multi-stage prod-deps install if
# image size or cold-start time becomes a real constraint.
#
# Base image: node:20-alpine (musl libc). Verified compatible with this
# project's one native/compiled dependency, @node-rs/argon2, which
# publishes a prebuilt @node-rs/argon2-linux-x64-musl binary (see
# node_modules/@node-rs/argon2/package.json's optionalDependencies).

FROM node:20-alpine AS build
WORKDIR /app

# Install the full workspace dependency graph first, from manifests only,
# so this layer stays cached across source-only changes.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci

# Bring in the rest of what's needed to generate the Prisma Client and
# build. Everything .dockerignore excludes (node_modules, dist/.next,
# .env*, .git, docs, tests) is never part of this build context.
COPY prisma ./prisma
COPY prisma.config.ts ./
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api

# `prisma generate` needs DATABASE_URL to resolve — prisma.config.ts reads
# it via env() — even though generate never opens a connection. This is a
# placeholder, never a real credential; the real DATABASE_URL is supplied
# at container *run* time (docker-compose.prod.yml / the platform's env
# vars), never baked into the image.
ENV DATABASE_URL="postgresql://build:build@build-time-placeholder:5432/build?schema=public"

# See ARCHITECTURE.md "Prisma engine strategy": even in full-WASM mode,
# `generate` runs one preflight step that resolves (but never executes) a
# schema-engine binary path. Pointing it at a binary that's already present
# in this image keeps that preflight from depending on network access to
# binaries.prisma.sh at build time, on any network — this project's own
# sandbox blocks that host, so this also keeps the image buildable there.
# Harmless on an unrestricted network: the path is only ever resolved, not
# executed, for `generate` when engineType = "wasm".
ENV PRISMA_SCHEMA_ENGINE_BINARY=/usr/local/bin/node

# Prisma Client (WASM engine — see ARCHITECTURE.md "Prisma engine
# strategy"; no native engine binary download needed). Must run before the
# Nest build since apps/api imports the generated client at compile time.
RUN npm run prisma:generate

# packages/shared first (apps/api imports its compiled dist/), then
# apps/api itself. Intentionally not `npm run build` (the root script also
# builds apps/web, which this image doesn't need).
RUN npm run build --workspace=packages/shared \
 && npm run build --workspace=apps/api


FROM node:20-alpine AS runtime
WORKDIR /app

RUN addgroup -S companio && adduser -S companio -G companio

# Whole-directory copy — see the symlink note above. Ownership fixed up in
# one layer rather than adding a second COPY --chown pass over everything.
COPY --from=build --chown=companio:companio /app /app

ENV NODE_ENV=production
USER companio

EXPOSE 4000

# GET /health is intentionally excluded from the /api/v1 prefix (see
# apps/api/src/main.ts) and returns only booleans/timings — see
# apps/api/src/health/health.controller.ts. No curl/wget in node:alpine, so
# use Node itself.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get({host:'127.0.0.1',port:process.env.API_PORT||4000,path:'/health'},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "apps/api/dist/main.js"]
