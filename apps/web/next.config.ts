import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@weyver/ui"],
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
}

export default nextConfig
