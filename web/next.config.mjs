/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // SofaScore team logos for nicer UI (read-only image proxying via Next/Image not used;
  // we render <img> directly, so allow the host here for any future next/image usage).
  images: { remotePatterns: [{ protocol: 'https', hostname: 'api.sofascore.com' }] },
};
export default nextConfig;
