/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The web app never talks to the database or holds secrets — it only
  // calls the API over HTTPS. Nothing here should ever need a service
  // credential.

  // Phase 11 (deployment): emit a minimal, self-contained `.next/standalone`
  // build (server + only the node_modules it actually traced/uses) so the
  // runtime Docker image doesn't need the full node_modules tree. See
  // apps/web/Dockerfile.
  output: 'standalone',
};

module.exports = nextConfig;
