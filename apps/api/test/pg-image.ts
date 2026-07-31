/* 🔴 R1·H-3 M1|整合測試所用的 PostgreSQL 映像。

   ## 為什麼不是 `postgres:16-alpine`

   繁中全文搜尋需 `pg_bigm`(migration 0037 會 `CREATE EXTENSION`)。
   prod 為 Cloud SQL,官方支援該擴充;dev 由 `docker/postgres/Dockerfile` 自建。
   **測試若用原生映像,migration 會失敗,或更糟 —— 被改成「擴充不存在就跳過」
   而讓測試在一個與 prod 不同的環境下通過。**

   本專案已多次栽在這類環境分歧(見記憶 `pitfall_privileged_lane_masks_security`:
   測試走特權連線 → RLS 不執法 → 測試綠但線上漏,同一 session 踩五次)。

   ## 映像不存在時的行為

   **刻意 fail-closed** —— testcontainers 會直接報「image not found」。
   那比靜默跳過 pg_bigm 好:前者五秒內查得出原因,後者要等到 prod 才發現。

   建置方式:`docker compose build postgres`(或 CI 內同一指令)。 */
export const PG_TEST_IMAGE = "weyver-postgres:16-bigm"
