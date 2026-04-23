/** @type {import('next').NextConfig} */
// /api/* is proxied at runtime by app/api/[...path]/route.ts using API_TARGET env.
const nextConfig = {
  output: "standalone",
  reactStrictMode: true,
  experimental: { instrumentationHook: false }
};
module.exports = nextConfig;
