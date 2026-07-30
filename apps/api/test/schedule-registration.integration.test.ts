import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify"
import { SchedulerRegistry } from "@nestjs/schedule"
import { Test } from "@nestjs/testing"
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { runMigrations } from "../src/db/migrate.js"

/* 🔴 F-9 §4.1|排程註冊次數。

   **為什麼需要一條專門的測試**|`ScheduleModule.forRoot()` 原本被三個 feature module
   各自呼叫。NestJS 10 以 deep-hash 去重 dynamic module,故三份被合併成一個實例、現況正常;
   **NestJS 11 改以物件參考判定**,同樣的寫法會變成三個獨立實例 → 每個 @Cron 跑三次
   (每分鐘的通知派送 = 重複寄信;每日的用量統計 = 計費數字錯)。

   **這個失效是測試套件結構上抓不到的**:單元測試不跑 cron,整合測試不會等一分鐘,
   561 個測試全綠與這個 bug 無關。它只會在 prod 以「客戶收到三封一樣的信」出現。
   ghostfolio 那次真實升級的維護者原話即為「Automated tests don't cover much in this case」。

   **兩道防線**|(1) 三個 cron 皆具名 —— 未命名者 orchestrator 用 `crypto.randomUUID()`
   當 key 而永不撞名,具名後重複註冊會讓 `addCronJob` 拋 DUPLICATE_SCHEDULER、**開機即失敗**;
   (2) 本測試斷言註冊數量,把「應為幾個」這件事釘在 CI 上。 */

const EXPECTED_CRON_JOBS = [
  "reliability.cleanup",
  "billing.usageRollup",
  "notifications.dispatch",
  "trash.purge",
  "event.fanout",
  "webhook.deliver",
] as const

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let app: NestFastifyApplication

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start()
  pool = new pg.Pool({ connectionString: container.getConnectionUri(), max: 4 })
  await runMigrations(pool)

  process.env.DATABASE_URL = container.getConnectionUri()
  process.env.APP_DATABASE_URL = container.getConnectionUri()
  const { AppModule } = await import("../src/app.module.js")
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await app.init()
}, 120_000)

afterAll(async () => {
  await app?.close()
  await pool?.end()
  await container?.stop()
})

describe("🔴 排程註冊(F-9:升 NestJS 11 前的防線)", () => {
  it("**每個 cron 恰好註冊一次** —— 重複註冊會讓通知重複寄送、用量統計 ×N", () => {
    const registry = app.get(SchedulerRegistry)
    const names = [...registry.getCronJobs().keys()]

    for (const expected of EXPECTED_CRON_JOBS) {
      expect(names.filter((n) => n === expected)).toHaveLength(1)
    }
    /* 總數也釘住:新增 cron 時這條會紅,強迫回來確認它是否該具名並列入清單
       —— 未具名的 cron 會以 UUID 進 registry,是這個機制的破口。 */
    expect(names).toHaveLength(EXPECTED_CRON_JOBS.length)
  })

  it("所有 cron 皆具名(未具名者以 UUID 註冊 → 重複註冊不會被偵測到)", () => {
    const registry = app.get(SchedulerRegistry)
    const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    const unnamed = [...registry.getCronJobs().keys()].filter((n) => uuidLike.test(n))
    expect(unnamed).toEqual([])
  })
})
