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

COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci

COPY packages/shared ./packages/shared
COPY apps/web ./apps/web

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
  CMD node -e "require('http').get({host:'127.0.0.1',port:process.env.WEB_PORT||3000,path:'/'},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "apps/web/server.js"]
