import knexFactory from "knex"
import { envSchema } from "../config/env.js"
import { SearchBackfillService } from "./search-backfill.service.js"
import { SearchIndexService } from "./search-index.service.js"

/* 🔴 R1·H-3|既有資料的搜尋索引補寫 CLI(**pilot 上線前的營運步驟**)。

     pnpm --filter @weyver/api search:backfill -- --tenant 1
     pnpm --filter @weyver/api search:backfill -- --tenant 1 --check   # 只對帳不寫
     pnpm --filter @weyver/api search:backfill -- --tenant 1 --force   # 全部重寫

   ## 為什麼是 CLI 不是 API 端點

   它會掃過整個租戶的所有記錄 —— 那是分鐘級的批次作業,不是一個請求該做的事;
   而且需要跨租戶的特權連線,不該存在一條 HTTP 路徑通往它。

   ## `--check` 的用途

   上線前先跑一次確認缺口、補完再跑一次確認歸零。日後若不為 0,
   代表有寫入路徑漏接索引 —— 那種問題不會自己現形,只會讓使用者覺得搜尋怪怪的。 */

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? undefined : process.argv[i + 1]
}

async function main(): Promise<void> {
  const env = envSchema.parse(process.env)
  const tenantRaw = arg("tenant")
  const tenantId = Number(tenantRaw)
  if (tenantRaw === undefined || !Number.isInteger(tenantId) || tenantId <= 0) {
    /* 不給預設租戶 —— 這個工具會寫入資料,猜錯對象比跑不起來糟得多 */
    console.error("用法:--tenant <id> [--check] [--force]")
    process.exit(2)
  }

  const knex = knexFactory({ client: "pg", connection: env.DATABASE_URL, pool: { min: 0, max: 4 } })
  const service = new SearchBackfillService(knex, new SearchIndexService())

  try {
    if (process.argv.includes("--check")) {
      const missing = await service.countMissing(tenantId)
      if (missing.length === 0) {
        console.log(`租戶 ${String(tenantId)}:索引完整,無缺漏`)
        return
      }
      console.log(`租戶 ${String(tenantId)}:以下表單有記錄未進索引`)
      for (const m of missing) {
        console.log(`  #${String(m.formId)} ${m.formName}:${String(m.missing)} 筆`)
      }
      /* 非零退出碼 —— 讓它可以直接放進上線前的檢查腳本 */
      process.exitCode = 1
      return
    }

    const result = await service.run(tenantId, { force: process.argv.includes("--force") })
    console.log(
      `租戶 ${String(tenantId)}:掃描 ${String(result.totalScanned)} 筆、補寫 ${String(result.totalIndexed)} 筆索引`,
    )
  } finally {
    await knex.destroy()
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
