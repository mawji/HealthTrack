import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdf-parse"],
  // hide the floating Next.js dev-tools button ("N") in development
  devIndicators: false,
};

export default nextConfig;
