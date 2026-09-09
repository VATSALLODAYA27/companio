/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The web app never talks to the database or holds secrets — it only
  // calls the API over HTTPS. Nothing here should ever need a service
  // credential.
};

module.exports = nextConfig;
