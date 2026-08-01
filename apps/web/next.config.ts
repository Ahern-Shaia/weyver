import type { NextConfig } from "next"

const ENGINE_API_ORIGIN = process.env.ENGINE_API_ORIGIN ?? "http://localhost:3001"

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@weyver/ui"],
  /* dev 指示器放**左上**。四個角落都有東西,取被擋住時代價最小的那個:
     右下 = 記錄頁 footer 的「儲存」(主要動作,擋住就存不了 —— 實測 e2e 直接卡死,
     錯誤訊息是 `<nextjs-portal> … intercepts pointer events`)· 左下 = 導覽軌的登出 ·
     右上 = 記錄頁的編輯/刪除/列印 · **左上 = 品牌連結**(方便性入口,且目標很大)。 */
  devIndicators: { position: "top-left" },
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
  // 同源代理引擎 API + Better Auth(免 CORS;cookie 同源;prod 由 reverse proxy 同源)
  async rewrites() {
    return [
      { source: "/api/engine/:path*", destination: `${ENGINE_API_ORIGIN}/api/:path*` },
      { source: "/api/auth/:path*", destination: `${ENGINE_API_ORIGIN}/api/auth/:path*` },
    ]
  },
}

export default nextConfig
