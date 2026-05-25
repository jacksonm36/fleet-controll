import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@fleet/ui", "@fleet/types"],
};

export default nextConfig;
