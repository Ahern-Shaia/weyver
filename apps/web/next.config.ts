import type { NextConfig } from "next"

const ENGINE_API_ORIGIN = process.env.ENGINE_API_ORIGIN ?? "http://localhost:3001"

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@weyver/ui"],
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
  // 同源代理引擎 API(免 CORS;prod 由 reverse proxy 同源)
  async rewrites() {
    return [{ source: "/api/engine/:path*", destination: `${ENGINE_API_ORIGIN}/api/:path*` }]
  },
}

export default nextConfig
