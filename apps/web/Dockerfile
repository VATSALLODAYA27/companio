# Companio Web — production image (Phase 12: free-tier deployment)
#
# Build context is the REPO ROOT (npm-workspaces monorepo — see
# apps/api/Dockerfile's header comment for the full explanation of why).
# Build with:
#
#   docker build -f apps/web/Dockerfile -t companio-web .
#
# Two stages:
#   1. `build`   — full npm workspace install, builds packages/shared, then
#                  `next build`.
#   2. `runtime` — copies the ENTIRE /app directory from `build` wholesale
#                  (full node_modules, not a pruned/standalone subset) —
#                  same tradeoff apps/api/Dockerfile already makes and
#                  documents, for the same reasons. This app now runs a
#                  custom server (server.js) in front of Next so it can
#                  proxy /api/v1 and /socket.io to the API service — see
#                  server.js's own header comment for why that exists —
#                  and Next's `output: 'standalone'` tracing only reliably
#                  covers Next's own generated server, not a custom one
#                  sitting in front of it, so this image doesn't use it.
#
# apps/web never touches the database or holds a secret of its own — it
# only proxies to the API server-to-server (server.js) and calls it from
# the browser under one shared origin — so this image needs no
# DATABASE_URL/SESSION_SECRET/etc, only API_PROXY_TARGET (see server.js).

FROM node:20-alpine AS build
WORKDIR /app

# --ignore-scripts here, and only here: the root package.json's
# `postinstall` runs `npm run build --workspace=packages/shared`, which
# needs that package's actual source (not yet copied at this point in the
# image) — see apps/api/Dockerfile's copy of this same comment for the
# full explanation. The explicit build below (once source is copied in)
# already covers it.
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci --ignore-scripts

COPY packages/shared ./packages/shared
COPY apps/web ./apps/web

# Next.js inlines every NEXT_PUBLIC_* var into the client JS bundle at
# BUILD time, not at container start -- so this can't be a normal runtime
# ENV set later by Render, it must be present here, before `next build`
# runs. Empty string (not unset) is deliberate: lib/api.ts does
# `process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api/v1'`,
# and only an explicit "" (not undefined) satisfies that nullish check to
# produce a same-origin relative path, which is what server.js's proxy
# requires (see server.js's header comment). Leaving this unset was a real
# bug: the bundle silently fell back to localhost:4000, which is
# unreachable from anyone's browser but this container.
ENV NEXT_PUBLIC_API_BASE_URL=""

RUN npm run build --workspace=packages/shared \
 && npm run build --workspace=apps/web


FROM node:20-alpine AS runtime
WORKDIR /app

RUN addgroup -S companio && adduser -S companio -G companio

COPY --from=build --chown=companio:companio /app ./

ENV NODE_ENV=production
# server.js reads WEB_PORT (falls back to 3000) — see apps/web/server.js
# and scripts/serve.js for the shared convention with local dev.
ENV WEB_PORT=3000

USER companio
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get({host:'127.0.0.1',port:process.env.PORT||process.env.WEB_PORT||3000,path:'/'},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "apps/web/server.js"]
