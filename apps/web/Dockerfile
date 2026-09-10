# Companio Web — production image (Phase 11)
#
# Build context is the REPO ROOT (npm-workspaces monorepo — see
# apps/api/Dockerfile's header comment for the full explanation of why).
# Build with:
#
#   docker build -f apps/web/Dockerfile -t companio-web .
#
# Two stages:
#   1. `build`   — full npm workspace install, builds packages/shared, then
#                  `next build` with `output: 'standalone'`
#                  (apps/web/next.config.js) — Next.js traces the actual
#                  runtime import graph and emits a minimal, self-contained
#                  server + node_modules subset under .next/standalone,
#                  rather than needing the whole workspace node_modules at
#                  runtime.
#   2. `runtime` — copies only that standalone output, plus the two things
#                  it deliberately excludes: .next/static (hashed JS/CSS
#                  assets) and public/ (this project's is currently just a
#                  placeholder — see apps/web/public/.gitkeep).
#
# In this npm-workspaces layout, Next.js's standalone output preserves the
# path from the workspace root (where package-lock.json lives) down to the
# app: the entrypoint lands at .next/standalone/apps/web/server.js, not at
# .next/standalone/server.js. Verified by actually running `next build` in
# this repo (see DEPLOYMENT.md's Phase 11 verification notes) — this is
# not the layout you get building apps/web as a standalone (non-workspace)
# Next.js project, so don't copy this Dockerfile into a non-monorepo
# project without re-checking that path.
#
# apps/web never touches the database, Redis, or any secret (see the
# comment in next.config.js) — it only calls the API over HTTPS from the
# browser, so this image needs no DATABASE_URL/SESSION_SECRET/etc at all.

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

COPY --from=build --chown=companio:companio /app/apps/web/.next/standalone ./
COPY --from=build --chown=companio:companio /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=companio:companio /app/apps/web/public ./apps/web/public

ENV NODE_ENV=production
# Next's generated standalone server.js reads PORT/HOSTNAME directly (not
# this project's dev-only WEB_PORT convention — see apps/web/package.json's
# `dev`/`start` scripts, which don't apply to this generated entrypoint).
# 0.0.0.0 so the container accepts connections from outside its own netns.
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

USER companio
EXPOSE 3000

# No API route / health endpoint exists on the web app itself (it's a
# static-ish Next app with no server-side data needs yet — see
# next.config.js's comment) — a plain GET of `/` is the closest thing to a
# meaningful liveness check without inventing a route this phase doesn't
# otherwise need.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get({host:'127.0.0.1',port:process.env.PORT||3000,path:'/'},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "apps/web/server.js"]
