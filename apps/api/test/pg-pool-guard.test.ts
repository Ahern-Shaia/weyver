import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/* 🔴 2026-08-08|**每個 `pg.Pool` 都要有 `'error'` 監聽者。**

   `Pool` 是 EventEmitter,而 Node 對沒有監聽者的 `'error'` 的語意是**丟出去** ——
   那不是 rejection(`await` 接不到),是 **uncaught exception**。
   打到**閒置**連線的錯誤沒有任何 `await` 攔得住。

   prod 的後果|Cloud SQL 維護重啟 / failover / `pg_terminate_backend` /
   網路抖動,全都對閒置連線送 FATAL → **API 整個 process 掛掉**。
   測試的後果|`container.stop()` 送 `57P01`(admin_shutdown)→ 整批測試以 1 退出,
   而 log 顯示 **1194 passed、零 FAIL 行**,看起來完全不像有問題。

   ⚠️ 這道檢查存在的理由|光把兩處補好,下一個 `new pg.Pool` 還是會漏。
   本 repo 已為「寫了規則但沒有檢查」付過六次代價。

   ⚠️ 它抓的是「有沒有走統一入口」,不是「有沒有真的掛上監聽」——
   後者要跑起來才知道,而入口只有兩個(`testPool` / `poolWithErrorGuard`),
   看得住。 */

const API_ROOT = new URL("..", import.meta.url).pathname

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    if (name.name === "node_modules" || name.name === "dist") continue
    const p = join(dir, name.name)
    if (name.isDirectory()) walk(p, out)
    else if (p.endsWith(".ts")) out.push(p)
  }
  return out
}

/* 兩個合法的建構點:測試走 `testPool`,執行期走 `poolWithErrorGuard`。 */
/* 兩個統一入口,加兩支一次性 migration CLI(跑完就退,連線錯誤**就是該讓它炸** ——
   遷移中途出事要大聲失敗,不是記個 log 然後帶著半套 schema 繼續),
   再加這支守衛自己(它的 regex 字面會 match 到自己)。 */
const ALLOWED = [
  "test/pg-pool.ts",
  "test/pg-pool-guard.test.ts",
  "src/db/db.module.ts",
  "src/db/migrate-cli.ts",
  "src/auth/migrate-auth.ts",
]

describe("pg.Pool 必須有 error 監聽", () => {
  it("禁止在 src / test 直接 new pg.Pool(統一走 testPool / poolWithErrorGuard)", () => {
    const offenders: string[] = []
    for (const dir of ["src", "test"]) {
      for (const file of walk(join(API_ROOT, dir))) {
        const rel = file.slice(API_ROOT.length)
        if (ALLOWED.some((a) => rel.endsWith(a))) continue
        readFileSync(file, "utf-8")
          .split("\n")
          .forEach((ln, i) => {
            if (/new pg\.Pool\s*\(/.test(ln)) offenders.push(`${rel}:${String(i + 1)}`)
          })
      }
    }
    expect(
      offenders,
      `改用 testPool(測試)或 poolWithErrorGuard(執行期):\n${offenders.join("\n")}`,
    ).toEqual([])
  })

  it("兩個合法建構點自己都掛了 'error'", () => {
    for (const rel of ["test/pg-pool.ts", "src/db/db.module.ts"]) {
      const src = readFileSync(join(API_ROOT, rel), "utf-8")
      expect(src, `${rel} 少了 'error' 監聽`).toMatch(/\.on\(\s*["']error["']/)
    }
  })
})
