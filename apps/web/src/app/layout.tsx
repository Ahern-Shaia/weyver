import type { Metadata } from "next"
import { IBM_Plex_Mono, Inter } from "next/font/google"
import "./globals.css"
import { Providers } from "./providers"

/* 🔴 2026-08-02|IBM Plex Sans → Inter(品牌板明訂)。
   品牌板逐字:「內文與介面統一使用 **Inter(英數)＋ Noto Sans TC(中文)**,
   僅用 Regular / Medium / Semibold / Bold 四階」。
   當初選 IBM Plex 是為避開「Inter = AI 預設」,該理由不敵品牌板明訂;
   且實測 Linear / Vercel / Attio 三個參照全為 Inter 系。
   代價誠實說:放棄同源鑄字(Plex Sans/TC/Mono 同一家),改為混家族。 */
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
})

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  display: "swap",
})

export const metadata: Metadata = {
  title: "Weyver 織雲",
  description: "以 Ragic 表單引擎為 substrate,取代 ERP,融合 MES + ISO 的一站式企業平台",
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-Hant-TW" className={`${inter.variable} ${plexMono.variable}`}>
      <head>
        {/* 繁中(Noto Sans TC,OFL);與 Inter 配對,品牌板明訂 */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* App Router 於 root layout 載入品牌 CJK 字型;no-page-custom-font 為 pages-router 規則 */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <Providers>{children}</Providers>
        {/* Glide Data Grid overlay editor 掛載點(須為 body 末子節點)*/}
        <div id="portal" />
      </body>
    </html>
  )
}
