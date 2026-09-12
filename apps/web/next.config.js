/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The web app never talks to the database or holds secrets — it only
  // calls the API over HTTPS. Nothing here should ever need a service
  // credential.

  // Phase 12 (free-tier deployment) runs a custom server (server.js) in
  // front of Next so it can proxy /api/v1 and /socket.io to the API
  // service — see server.js's header comment for why. Next's `standalone`
  // output only reliably traces its own generated server, not a custom
  // one sitting in front of it, so this image ships the full node_modules
  // tree instead (the same accepted tradeoff apps/api/Dockerfile already
  // makes, for the same reason — see that Dockerfile's comment).
};

module.exports = nextConfig;
