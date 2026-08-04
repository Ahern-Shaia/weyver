import { execSync } from "node:child_process"
import { readdirSync, readFileSync } from "node:fs"
import pg from "pg"

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://weyver:weyver_dev@127.0.0.1:5433/weyver"

/* e2e 前置:migration(冪等)+ 確保存在 tenant 1(dev guard 預設租戶;fresh DB 首插即 id 1)。
   前提:PG 已啟(docker compose up -d postgres)。

   ⚠️ **註冊 / 登入端點限流 5 次/分,而整套 e2e 共用同一個來源 IP**
   (`x-weyver-peer-ip`,見 apps/api auth.ts)。目前 3 支 spec 會註冊公司
   (auth / mfa / security),加上各自的登入正好在額度內。
   **再加一支「會註冊或登入」的 spec 就會撞 429**,而畫面上只會顯示
   「Too many requests」——看起來像功能壞掉,其實是限流。
   屆時的正解是讓新 spec **重用既有帳號**(Playwright 的 storageState),
   而不是把 production 的限流調鬆。

   ⚠️ **同一分鐘內連跑兩輪整套 e2e 會出現假紅**,而且每輪紅的 spec 都不同 ——
   限流是逐 IP 的滑動視窗,兩輪的請求會疊在同一個桶裡。受影響的端點與額度:
   `/sign-up/email` 5 · `/sign-in/email` 20 · `/two-factor/verify-totp` 5 ·
   `/two-factor/verify-backup-code` 5(見 apps/api `auth.ts` 的 customRules)。
   單輪的用量都在額度內;要連跑請中間等滿 60 秒。
   實測症狀:`429 POST /auth/two-factor/verify-totp`,但畫面上只看到「等不到某個元素」。 */
export default async function globalSetup(): Promise<void> {
  execSync("pnpm --filter @weyver/api db:migrate", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL },
  })
  // Better Auth 自管 schema(auth.spec 需 user/session/organization 表)
  execSync("pnpm --filter @weyver/api db:migrate:auth", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL },
  })

  const pool = new pg.Pool({ connectionString: DATABASE_URL })
  try {
    const existing = await pool.query("SELECT id FROM tenants WHERE id = 1")
    if (existing.rows.length === 0) {
      await pool.query(
        "INSERT INTO tenants (name) SELECT 'e2e 廠' WHERE NOT EXISTS (SELECT 1 FROM tenants)",
      )
    }
    await ensureDevOrg(pool)
    assertNamingConvention()
    await purgePreviousRunArtifacts(pool)
  } finally {
    await pool.end()
  }
}

/* e2e 產物回收(2026-07-28)。

   **問題**|每次跑 e2e 都建約 20 張表卻從不清理;累積到 250+ 張後,工作區/設計器的表單清單
   載入變慢,全套執行開始隨機逾時(個別跑都過)。這已三度干擾判讀。

   **做法**|以**命名慣例**回收:所有 spec(UI 建表與 API 建表)一律以 `E2E` 前綴命名,
   故一條 soft delete 即可涵蓋兩者,且**不會碰到手建的 dev 資料**(名稱不以 E2E 起始)。

   **為何在 setup 而非 teardown**|(a) 上一輪若中途崩潰,teardown 不會執行 → 髒資料仍累積;
   setup 清理則恆等冪且可自我修復;(b) 失敗後產物**留在原地可供查因**,下一輪才清掉。

   **為何只 soft delete**|應用各處一律以 `deleted_at IS NULL` 過濾,清單長度即回到常數,
   逾時症狀因此消失。物理表(`data.t*`)保留:P0-1 spike 已實證 10K 表仍近線性,
   而刪表會讓 metadata 與物理狀態分歧、反而不利事後查因。要徹底重置就重建 dev DB。 */
/* 🔴 dev 租戶 1 綁一個 org。

   dev 的租戶解析走 `x-dev-tenant` header 且**刻意不觸 session**(OQ-AUTH-7),
   所以在 e2e 裡「註冊新公司」不會改變後續請求的租戶 —— 仍是租戶 1。
   而成員管理需要 org(Better Auth 的 `member` 表以 org 為界),
   租戶 1 原本 `auth_org_id` 為 NULL → **成員功能在 dev 完全不可用**。

   這不只是測試的問題:任何人 clone 下來跑 dev,成員頁都是空的且加不了人。
   故在此補上(冪等),讓 dev 與 e2e 都能真的走到那條路徑。 */
async function ensureDevOrg(pool: pg.Pool): Promise<void> {
  const orgId = "dev-org-tenant-1"
  await pool.query(
    `INSERT INTO "organization" (id, name, slug, "createdAt")
     VALUES ($1, 'e2e 廠', 'e2e-dev', now())
     ON CONFLICT (id) DO NOTHING`,
    [orgId],
  )
  await pool.query("UPDATE tenants SET auth_org_id = $1 WHERE id = 1 AND auth_org_id IS NULL", [
    orgId,
  ])
}

/* 🔴 命名慣例必須是**可檢查的**,否則它只是註解。

   2026-08-04 實測:dev 租戶累積到 **500 張表單**,全套 e2e 從 12 分鐘變成 23.6 分鐘、
   54 條紅(而每一條單跑都過)。真因是回收只認 `E2E%`,而**至少七支 spec 用了別的前綴**
   (`LNK…` / `日期格式…` / `貼上…` / `簽核進階…` 等)—— 上面那段「一律以 E2E 前綴命名」
   的說明寫了兩個月,沒有任何東西在檢查。

   同型教訓見 `memory/pitfall_rule_without_check_always_drifts`:
   **寫規則的同一個 commit 就要做出檢查。** */
function assertNamingConvention(): void {
  const dir = new URL(".", import.meta.url).pathname
  const offenders: string[] = []
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".spec.ts"))) {
    const src = readFileSync(`${dir}${file}`, "utf8")
    for (const m of src.matchAll(/name: `([^`]*)`/g)) {
      const name = m[1] ?? ""
      if (name.startsWith("E2E")) continue
      /* ⚠️ 只認**建表**的那一種 —— `name:` 也大量出現在 Playwright 的定位器選項
         (`getByRole("heading", { name: ... })`)。以「後面近處有 `fields:`」判別:
         建表 payload 一定帶欄位定義,斷言不會。
         初版沒有這一條,三條誤報裡有兩條是標題斷言。 */
      const after = src.slice(m.index ?? 0, (m.index ?? 0) + 300)
      if (!after.includes("fields:")) continue
      offenders.push(`${file}: ${name}`)
    }
  }
  if (offenders.length > 0) {
    throw new Error(
      `e2e 建立的表單一律以 E2E 前綴命名(回收機制靠它)。不合規:\n  ${offenders.join("\n  ")}`,
    )
  }
}

async function purgePreviousRunArtifacts(pool: pg.Pool): Promise<void> {
  const forms = await pool.query<{ count: string }>(
    `UPDATE form_def SET deleted_at = now()
     WHERE name LIKE 'E2E%' AND deleted_at IS NULL`,
  )
  await pool.query(
    `UPDATE field_def SET deleted_at = now()
     WHERE deleted_at IS NULL
       AND form_id IN (SELECT id FROM form_def WHERE name LIKE 'E2E%')`,
  )
  const purged = forms.rowCount ?? 0
  if (purged > 0) console.info(`[e2e] 回收上一輪產物:${String(purged)} 張表單`)

  /* 🔴 匯出的**每日配額**也要歸零。

     `EXPORT_MAX_PER_DAY = 10` 是產品刻意的界線(擋接力式無限匯出),
     但它讓 `data-export.spec` 在同一個 dev DB 上**一天只能跑十次** ——
     第十一次起 create 被擋,而測試看到的症狀是「清單最上面那列沒有換人」,
     指不到真正的原因。2026-08-04 實際踩到。

     只刪 dev 租戶今天的紀錄:配額是「當日」的,舊資料留著不影響。 */
  const jobs = await pool.query(
    `DELETE FROM export_job WHERE tenant_id = 1 AND created_at >= current_date`,
  )
  const dropped = jobs.rowCount ?? 0
  if (dropped > 0) console.info(`[e2e] 歸零匯出配額:${String(dropped)} 筆`)
}
