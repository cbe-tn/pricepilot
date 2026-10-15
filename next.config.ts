import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["xlsx", "pg", "bcryptjs"],
  experimental: {
    // Server Actions default to a 1 MB body; stock imports (CSV/Excel) can be larger.
    serverActions: { bodySizeLimit: "25mb" },
  },
};

export default nextConfig;
