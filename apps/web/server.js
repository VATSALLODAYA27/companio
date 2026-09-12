#!/usr/bin/env node
'use strict';

// Production custom server — only used when API_PROXY_TARGET is set (see
// scripts/serve.js). This is Phase 12 (free-tier deployment) infrastructure;
// everything below exists to solve one specific problem, so read this
// comment before touching any of it.
//
// The problem: on the free-tier deployment (see DEPLOYMENT.md's "Free-tier
// deployment" section), this web app and the NestJS API are two separate
// Render services, each getting its own `*.onrender.com` subdomain.
// `onrender.com` is on the public suffix list (Render does this
// deliberately, same as vercel.app/herokuapp.com/pages.dev), so those two
// subdomains are different "sites", not just different origins on the same
// site. The API's session cookie is `SameSite=Lax` (see
// apps/api/src/auth/auth.controller.ts's comment for why it stays that way
// rather than being loosened to `None`) — a Lax cookie is never attached to
// a cross-site fetch()/XHR request, so a browser talking directly to the
// API's own origin would see login "succeed" (the Set-Cookie response is
// still honored) and then silently look logged-out on every call after
// that. Loosening to `SameSite=None` doesn't actually fix it either: Safari
// and iOS block third-party cookies outright by default regardless of
// SameSite, so that would trade "broken for everyone" for "broken only on
// Safari/iOS" — not good enough.
//
// The fix: make sure the browser only ever talks to ONE origin — this
// service's own. `server.js` proxies `/api/v1/*` (REST) and `/socket.io/*`
// (the Socket.IO handshake, including its WebSocket upgrade) straight
// through to the API service's public URL, server-to-server, and hands
// every other request to Next's own request handler. From the browser's
// point of view there is exactly one origin — same-origin, not just
// same-site — so none of the above applies anymore.
//
// Local dev doesn't need any of this: the API and web app run on two ports
// of the same `localhost`, which is already same-site (SameSite rules key
// on scheme + registrable domain, not port), so `npm run dev` keeps using
// plain `next dev` via scripts/serve.js.

const { createServer } = require('http');
const next = require('next');
const httpProxy = require('http-proxy');

// `PORT` takes priority over `WEB_PORT`: Render (and most PaaS free
// tiers) inject PORT and require the app to bind to it. Local dev never
// sets PORT, so WEB_PORT (defaulting to 3000) still governs there.
const port = Number(process.env.PORT) || Number(process.env.WEB_PORT) || 3000;
const target = process.env.API_PROXY_TARGET;

if (!target) {
  console.error(
    'server.js requires API_PROXY_TARGET (the API service\'s base URL, e.g. https://companio-api.onrender.com) to be set.',
  );
  process.exit(1);
}

const app = next({ dev: false, dir: __dirname });
const handle = app.getRequestHandler();

const proxy = httpProxy.createProxyServer({
  target,
  changeOrigin: true,
  ws: true,
  xfwd: true,
});

proxy.on('error', (err, _req, res) => {
  // eslint-disable-next-line no-console
  console.error('Proxy error reaching the API:', err.message);
  if (res && typeof res.writeHead === 'function' && !res.headersSent) {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('Bad gateway: could not reach the API.');
  }
});

// The Socket.IO client always talks to `/socket.io/...` regardless of
// what path the app is served from — see socket.io-client's default
// `path` option, unchanged in lib/socket.ts — so that prefix, plus the
// REST API's own prefix, are the only two paths this server ever
// forwards. Everything else is this Next.js app's own pages/assets.
function isProxiedPath(url) {
  return url.startsWith('/api/v1') || url.startsWith('/socket.io');
}

app.prepare().then(() => {
  const server = createServer((req, res) => {
    if (isProxiedPath(req.url)) {
      proxy.web(req, res);
    } else {
      handle(req, res);
    }
  });

  server.on('upgrade', (req, socket, head) => {
    if (isProxiedPath(req.url)) {
      proxy.ws(req, socket, head);
    } else {
      socket.destroy();
    }
  });

  server.listen(port, '0.0.0.0', () => {
    // eslint-disable-next-line no-console
    console.log(`Web app listening on :${port}, proxying ${target} for /api/v1 and /socket.io`);
  });
});
