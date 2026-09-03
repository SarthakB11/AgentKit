/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
  },
  // Next 16 writes agent instruction files into the app on `next dev`. This kit
  // lives inside a repo that already has its own, so don't generate them.
  agentRules: false,
};

export default nextConfig;
