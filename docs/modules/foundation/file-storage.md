# file-storage.md — [F-5] 檔案儲存基礎設施(上傳 / 下載 / 附件欄完成)設計文件

> ✅ **狀態：APPROVED — OQ-FS-1..7 已裁定(2026-07-27;全採建議 = 全 A);進入 M1**
> **裁定摘要**｜1=A 驅動抽象(local + S3-compatible) · 2=A 伺服器代理上傳 · 3=A API 代理下載 · 4=A uuid key 非憑證 · 5=A 兩階段綁定 · 6=A 病毒掃描歸 P1 · 7=A file_object 走 RLS 車道。
>
> **解三個已 SHIPPED 模組共同記錄的硬阻塞** —— 這是 R1 目前最有槓桿的基礎設施缺口:
> - **OQ-FTP-6**(field-types-parity):image / signature / attachment 上傳「依賴檔案儲存基礎設施(上傳端點 + 物件儲存抽象 + 病毒掃描 + 大小/數量限制)」→ 排除 P0。
> - **OQ-PM-1**(print-merge):合併列印 / 客製列印報表之**範本上傳**、列印輸出**寫回附件欄**、浮水印 → 同一阻塞,歸 P1。
> - 連帶:PDF 密碼/浮水印、公司 logo 上傳、大量匯出寫回,皆卡在此。
>
> **定位**|Foundation(橫切基礎設施),非 R1 功能模組 —— 一次做對,三個模組同時解鎖。
>
> **既有決策(不重議,本 M0 只落地)**|`docs/11 §3.6` 已定 **Cloudflare R2**(S3-compat、**零 egress 費**為關鍵成本優勢)+ CDN;`§16.7/16.8` 明示 **避免 lock-in、用 managed-OSS / S3 相容**(AWS S3 ~$6/月、GCP GCS ~$4/月);`docs/22` 已明列上傳安全鐵則:**magic bytes 驗型別(非副檔名)+ 大小上限 + webroot 外 + 生成檔名 + `Content-Disposition: attachment` + `nosniff`**。
>
> 作者:Claude Code(草擬)
> 版本:v0.1(2026-07-27)
> 證據:docs/11 §3.6 / §16.5-16.11(物件儲存選型與 lock-in 立場)、docs/22(檔案上傳 P1 安全要求 + SSRF + 供應鏈)、docs/modules/R1/field-types-parity.md OQ-FTP-6、print-merge.md OQ-PM-1、現況盤點(零檔案 I/O、attachment 欄 `[{key,name}]` 契約已存在但 key 語意未定、Fastify 無 multipart、body limit 預設 256KB、權限管線 TenantGuard/PermissionGuard/maskRead 齊備)

---

## 1. 目標與範圍

### 1.1 目標(P0)

1. **儲存驅動抽象**|`StorageDriver` 介面(put / get / delete / stat)+ 兩實作:**local FS**(dev / on-prem edge 自 host)與 **S3-compatible**(prod:R2 / S3 / GCS / MinIO 皆同一驅動)。以 injection token 注入,依 env 切換(承 AGENTS「依賴抽象 + injection token」)。
2. **上傳端點**|`POST /api/files`(multipart)——**伺服器代理上傳**:驗權限 → 大小/數量上限 → **magic bytes 驗型別**(非副檔名)→ **生成檔名**(uuid,不採使用者檔名)→ 落儲存 → 寫 `file_object` metadata → 回 `{key, name, size, mime}`。
3. **下載端點**|`GET /api/files/:key`——**API 代理串流**:tenant scope + 表單級 `view` + **欄位級 hidden 檢查(maskRead 同源)** → `Content-Disposition: attachment` + `nosniff` + 串流回應。
4. **attachment 欄完成**|填單可上傳/移除、記錄頁可下載;沿用既有 `[{key,name}]` JSONB 契約(**零欄位型別變更**)。
5. **兩階段綁定 + 孤兒回收**|上傳先產生 `pending` 檔(綁 tenant/form/field,未綁 record)→ 記錄存檔後轉 `bound`;未綁定超時者由清理標記回收(不刪實體,soft)。
6. **配額與上限**|每檔大小上限、每欄檔數上限(承欄型 max 50)、**每租戶總量配額**(承 docs/04 A 配額);超限明示拒絕。

### 1.2 對應訴求

| 子題 | 訴求 | 對應 |
|---|---|---|
| 檔案儲存 | 解 OQ-FTP-6 / OQ-PM-1 阻塞;attachment 為 Ragic parity 基本欄型(客戶單據附照片/文件) | docs/25 B 欄位型別(attachment)、H 列印(範本);docs/11 §3.6 |

### 1.3 不做的事

- ❌ **病毒掃描(ClamAV)**|需常駐 daemon + 病毒庫更新(新 infra + ops);P0 以 **magic bytes + 型別白名單 + 大小上限 + 生成檔名 + attachment disposition + nosniff** 覆蓋 docs/22 明列要求 → 掃描列 **P1**(OQ-FS-6)。
- ❌ **presigned URL 直傳 / 直下**|P0 走伺服器代理(可集中驗型別/權限、正確設 header);大檔直傳與 CDN 簽名 URL → P1(OQ-FS-2/3)。
- ❌ **image / signature 欄型**|本模組只解「基礎設施 + attachment 欄」;image/signature 為 field-types-parity 之 P1 子件(解鎖後另行落地)。
- ❌ **合併列印範本上傳 + Carbone**|print-merge P1(解鎖後另行落地);本模組只提供儲存能力。
- ❌ **縮圖 / 影像處理(Sharp)、CDN 快取、浮水印**|P1(docs/11 §3.6 已列 Sharp self-host 為選項)。
- ❌ **版本化 / 復原、跨區複製**|P2。

---

## 2. 上游 / 既有現況走查

| 子題 | 現況 | Gap |
|---|---|---|
| attachment 欄型 | ✅ `valueSchema: [{key:string≤500, name:string≤255}] max 50`;`toDbValue` JSON 序列化 | **key 語意未定** → 本模組定義(且不改欄型契約)|
| Fastify multipart | ❌ 未註冊;body limit 預設 256KB | 註冊 `@fastify/multipart` + 上傳路由 body 上限 |
| 安全標頭 | ✅ `app-setup.ts` onSend(nosniff / DENY / no-referrer / HSTS)| 下載端點另加 `Content-Disposition: attachment` |
| env 設定 | ✅ Zod + `superRefine` prod fail-fast(DATABASE_URL / BETTER_AUTH_SECRET…)| 加 `STORAGE_*`(driver/bucket/endpoint/keys/quota)同 pattern |
| 權限管線 | ✅ TenantGuard / PermissionGuard / `@RequiresFormAction` / `EffectivePermissions.hasAction` / `maskRead` 欄位級 | 下載端點復用(欄位 hidden ⇒ 拒下載)|
| 現有檔案 I/O | ❌ 全無(Excel 匯入為**瀏覽器端**解析後送 JSON)| 全新 |
| 物件儲存決策 | ✅ docs/11 §3.6 **R2**(S3-compat、零 egress);§16 避 lock-in | 落地為 S3-compatible 驅動 + local 驅動 |
| 上傳安全要求 | ✅ docs/22 已明列(magic bytes / 大小 / webroot 外 / 生成檔名 / disposition / nosniff)| 全數實作 |

---

## 3. scope 切分

| 里程碑 | 內容 | 估算 |
|---|---|---|
| **M1 驅動 + 設定** | `StorageDriver` 介面 + `LocalStorageDriver`(dev,webroot 外目錄)+ `S3StorageDriver`(`@aws-sdk/client-s3`,相容 R2/S3/GCS/MinIO)+ env `STORAGE_*` + DI token + 單元測 | 0.08 mo |
| **M2 上傳/下載端點 + metadata** | `file_object` 表(migration 0014,RLS)+ `POST /api/files`(multipart、magic bytes、上限、生成 key)+ `GET /api/files/:key`(權限 + 欄位 hidden + disposition + 串流)+ `DELETE` + integration 測(跨租戶/型別/上限/hidden 欄拒下載)| 0.12 mo |
| **M3 兩階段綁定 + 配額** | pending→bound 綁定(記錄存檔時)+ 孤兒標記回收 + 每租戶配額檢核 + 測 | 0.06 mo |
| **M4 前端 attachment 欄** | 填單上傳(拖放/選檔、進度、移除)+ 記錄頁下載清單 + 錯誤訊息(型別/大小/配額)| 0.08 mo |
| **M5 固化 + FMEA** | Playwright(上傳→存檔→下載→刪除)+ §12;doc v1.0 + MODULES ✅ + **回填三模組解鎖註記** | 0.03 mo |

**合計 ≈ 0.37 mo**。M1–M3 後端 / M4–M5 前端**分開 commit**。

---

## 4. 設計要點

### 4.1 驅動抽象(M1;OQ-FS-1)

```ts
interface StorageDriver {
  put(key: string, body: Readable | Buffer, meta: { mime: string; size: number }): Promise<void>
  get(key: string): Promise<Readable>
  delete(key: string): Promise<void>
  stat(key: string): Promise<{ size: number } | null>
}
```
- `LocalStorageDriver`:`STORAGE_LOCAL_DIR`(**webroot 外**,docs/22);dev 與 on-prem Edge 用。
- `S3StorageDriver`:`@aws-sdk/client-s3`(Apache-2.0)—— 同一驅動涵蓋 **R2 / S3 / GCS(相容模式)/ MinIO**(`STORAGE_ENDPOINT` 可設)→ 無 lock-in(docs/11 §16)。
- DI:`STORAGE_DRIVER` token,`useFactory` 依 env 選擇(prod 缺 key → fail-fast,承 env.ts pattern)。

### 4.2 key 語意 + 租戶隔離(M2;OQ-FS-4)
- `key = t{tenantId}/f{formId}/{uuidv4}{ext}` —— **生成檔名**(不採使用者檔名,docs/22);原始檔名存 metadata `name`。
- **key 不是授權憑證**:下載一律回查 `file_object` 取得 (tenant, form, field) 再驗權限(BOLA 防護,docs/22 鐵則 2);猜到 key 也無用。
- `file_object(key PK, tenant_id, form_id, field_id, record_id?, name, mime, size, status〔pending|bound|orphaned〕, created_by, created_at, deleted_at)` + RLS FORCE。

### 4.3 上傳(M2)
1. `@RequiresFormAction("edit")` + TenantGuard/PermissionGuard;另驗該 field 為 `write`(承 `assertWritable` 同源判定)。
2. 大小上限(`STORAGE_MAX_FILE_MB`,預設 20)、單欄檔數上限(≤50 承欄型)、租戶配額(M3)。
3. **magic bytes 驗型別**(讀前 N bytes 比對)+ **副檔名/MIME 白名單**(圖片/PDF/Office/文字);不符即拒(不靜默改名放行)。
4. 落儲存 → 寫 metadata(`status=pending`)→ 回 `{key, name, size, mime}`;前端把 `{key,name}` 併入該欄值送出記錄。

### 4.4 下載(M2;OQ-FS-3)
- `GET /api/files/:key` → 查 metadata(tenant scope)→ 驗表單 `view` + **欄位 `fieldVisibility !== "hidden"`**(與 `maskRead` 同源,FMEA S2)→ 串流 + `Content-Disposition: attachment; filename*=UTF-8''…` + `X-Content-Type-Options: nosniff`(承既有 onSend)+ 保守 `Content-Type`。

### 4.5 兩階段綁定 + 孤兒(M3;OQ-FS-5)
- 上傳先 `pending`(綁 tenant/form/field、未綁 record)→ **記錄存檔時**(create/update)掃該筆 attachment 欄值之 key,標 `bound` + 寫 `record_id`。
- 未於期限內綁定(如 24h)之 `pending` → 標 `orphaned`(soft;實體刪除由清理 job,P1)。
- 記錄刪除 → 檔案不即刪(soft delete 語意一致,承 records);實體回收 P1。

---

## 7. 資料模型變動

### 7.2 SQL Migration
- **`0014_file_object.sql`**:`file_object` 表 + **RLS FORCE + tenant policy**(記錄類資料,非 metadata 定義 → 走 RLS 車道,與 records 同級;OQ-FS-7)+ `GRANT` 給 `weyver_app` + 索引(tenant/form/record、status)。
- attachment 欄型契約**不動**(`[{key,name}]`)→ 零欄位遷移。

### 7.3 RLS / Permission
- `file_object` RLS 綁 `tenant_id`(最後防線);app 層另驗表單/欄位權限。
- 上傳 = 表單 `edit` + 該欄 `write`;下載 = 表單 `view` + 該欄非 `hidden`;刪除 = 表單 `edit`。

---

## 7-bis. 安全(docs/22 明列要求逐條對照)

| docs/22 要求 | 本模組落地 |
|---|---|
| magic bytes 驗型別(非副檔名)| 讀首 N bytes 比對簽章 + 白名單;不符即 415 |
| 大小上限 | `STORAGE_MAX_FILE_MB` + Fastify multipart `limits` + 租戶配額 |
| webroot 外 | local driver 指向非靜態服務目錄;**不註冊 `@fastify/static`** |
| 生成檔名 | uuid key,原名僅存 metadata 並於下載以 `filename*` 帶出 |
| `Content-Disposition: attachment` | 下載端點固定設定(不 inline,防 HTML/SVG XSS) |
| `nosniff` | 既有 onSend 已全域設定 |
| BOLA / 越權 | key 非憑證;一律回查 metadata + 表單/欄位權限 + RLS |
| SSRF | 本模組不 fetch 使用者 URL(無「由 URL 匯入檔案」功能)|
| 供應鏈 | 僅加 `@aws-sdk/client-s3`(Apache-2.0)+ `@fastify/multipart`(MIT);lockfile + OSV 掃描既有 |

補充:SVG 一律以 `attachment` 下載(不 inline 渲染);圖片預覽於 P1 影像處理(Sharp 轉檔)再議。

---

## 8. 測試策略

| 層級 | 覆蓋 | 位置 |
|---|---|---|
| Unit | magic bytes 判定 / key 生成 / 配額計算 / local driver put-get-delete | `*.test.ts` |
| Integration(api)| 上傳(權限/型別白名單/magic 不符拒/大小超限拒/配額超限拒)、下載(跨租戶拒、**hidden 欄拒**、disposition 標頭)、綁定(pending→bound)、刪除 | Testcontainers + tmp dir driver |
| e2e(Playwright)| attachment 欄上傳 → 存檔 → 記錄頁下載連結 → 移除 | `file-storage.spec.ts` |

---

## 9. 落地順序與里程碑

| 里程碑 | 內容 | 狀態 |
|---|---|---|
| **M0** | 本檔 → APPROVED(OQ-FS-1..7 裁定,全採建議)| ✅ |
| **M1** | 驅動抽象 + env 設定(api commit)| ⏳ |
| **M2** | file_object(0014)+ 上傳/下載/刪除端點 | ⏳ |
| **M3** | 兩階段綁定 + 孤兒 + 配額 | ⏳ |
| **M4** | 前端 attachment 欄(上傳/下載/移除)| ⏳ |
| **M5** | file-storage.spec + FMEA + doc v1.0 + MODULES ✅ + 回填解鎖註記 | ⏳ |

---

## 10. 開放問題(OQ-FS-N)— ✅ 已裁定 2026-07-27(全採建議 = 全 A)

> 全數採「建議」欄。進入 M1。

| # | 議題 | 選項 | 建議 = 裁定 |
|---|---|---|---|
| **OQ-FS-1** | 儲存驅動 | A. **抽象介面 + local(dev/on-prem)+ S3-compatible(prod)**,單一 `@aws-sdk/client-s3` 涵蓋 R2/S3/GCS/MinIO<br>B. 直接綁 R2 SDK | **A** — docs/11 §3.6 已選 R2 但 §16 明示**避免 lock-in**;S3 相容抽象讓 self-host(MinIO)與各雲皆可,亦滿足 OSS-only(自 host 選項恆在)。local 驅動使 dev/測試零外部依賴。**證據**:docs/11 §3.6 + §16.7/16.8 |
| **OQ-FS-2** | 上傳方式 | A. **伺服器代理 multipart**(集中驗型別/權限/配額)<br>B. presigned URL 直傳 | **A** — docs/22 要求 **magic bytes 驗型別**,直傳無法在落儲存前驗;pilot 規模頻寬非瓶頸。大檔直傳(分段 + 事後驗)→ P1。**證據**:docs/22 上傳鐵則 |
| **OQ-FS-3** | 下載方式 | A. **API 代理串流**(每次驗權限 + 正確 disposition/nosniff)<br>B. presigned 短期 URL | **A** — 權威授權(含**欄位級 hidden**)+ 可確保 `Content-Disposition: attachment`;presigned 一旦簽出即無法即時撤銷、且難保 header。CDN/presigned → P1(伴隨頻寬成長)。**證據**:docs/22 + maskRead 同源要求 |
| **OQ-FS-4** | key 語意 | A. **uuid 生成 key + metadata 為授權真實來源**(key 非憑證)<br>B. 簽章 key 自帶授權 | **A** — 承 docs/22 BOLA 鐵則(UUID 非授權控制)+ 生成檔名要求;猜到 key 亦需通過權限查核 |
| **OQ-FS-5** | 上傳與記錄的綁定 | A. **兩階段(pending → 記錄存檔時 bound)+ 孤兒標記**<br>B. 僅允許已存在記錄上傳 | **A** — 新建記錄時就要能附檔(Ragic/Airtable 皆可);B 會逼使用者先存空記錄,體驗差。孤兒以 status + 期限標記,實體回收 job → P1 |
| **OQ-FS-6** | 病毒掃描 | A. **P0 不做**(magic bytes + 白名單 + 大小 + 生成檔名 + attachment disposition + nosniff 已覆蓋 docs/22 明列項);ClamAV → P1<br>B. P0 即接 ClamAV | **A** — ClamAV 需常駐 daemon + 病毒庫更新(新 infra + ops,違 solo 低 ops 原則);docs/22 未將掃描列為必要項。P1 補上並於 doc 明標殘留(誠實) |
| **OQ-FS-7** | `file_object` 車道 | A. **RLS 車道**(tenant policy FORCE + weyver_app grant,與 records 同級)<br>B. authz Tier-1 DRIZZLE 車道(如 view_def/label_def)| **A** — 檔案 metadata 是**租戶記錄資料**(隨記錄生滅、量大),非表單定義 metadata;RLS 為最後防線更合適。定義類走 Tier-1 之慣例不適用於此 |

---

## 12. 失效場景反思(FMEA)— M5 收尾必填(R17);pre-mortem 預列

| # | 場景 | 預定緩解 | Sev |
|---|---|---|---|
| S1 | 猜 key 下載他人/他租戶檔案(BOLA)| key 非憑證;回查 metadata + tenant scope + 表單權限 + RLS | P0 |
| S2 | 附件掛在 hidden 欄仍可下載(繞欄位級權限)| 下載驗 `fieldVisibility !== hidden`(maskRead 同源);integration 斷言 | P0 |
| S3 | 惡意檔上傳(偽副檔名 / HTML·SVG XSS / 可執行)| magic bytes + 白名單 + 生成檔名 + `Content-Disposition: attachment` + nosniff + 不 inline | P0 |
| S4 | 路徑穿越 / key 注入(`../`)| key 由伺服器生成(uuid),使用者輸入不入路徑;driver 端二次驗 key 格式 | P0 |
| S5 | 大檔 / 大量上傳耗盡磁碟或頻寬(DoS)| 單檔上限 + 欄檔數上限 + 租戶配額 + throttler;超限明示拒 | P1 |
| S6 | 孤兒檔累積(上傳後未存檔)| pending 狀態 + 期限標 orphaned;回收 job P1(明標殘留)| P1 |
| S7 | 記錄刪除後檔案仍可下載 | 下載檢查記錄 soft-delete 狀態(bound 檔隨記錄不可讀);實體回收 P1 | P1 |
| S8 | prod 缺 STORAGE_* 設定 → 執行期才爆 | env `superRefine` prod fail-fast(承既有 pattern)| P1 |
| S9 | local driver 目錄落在 webroot / 被靜態服務 | 不註冊 `@fastify/static`;目錄設定於 repo 外;文件明載 | P1 |
| S10 | 部署順序:前端先於 0014 migration | migration 必先(R10);缺表 → 上傳端點 500 前先 fail-fast 檢核 | P1 |

> **檢查點**:M5 收尾時所有 P0(S1–S4)須 ✅ 方可標 SHIPPED。

---

## 13. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-07-27 | v0.2 | **OQ-FS-1..7 全裁定(全採建議=全 A);DRAFT → APPROVED,進 M1**。定調:local + S3-compatible 雙驅動抽象;伺服器代理上傳(magic bytes)與下載(欄位 hidden + attachment disposition);uuid key 非授權憑證;兩階段 pending→bound;病毒掃描 P1;file_object 走 RLS 車道 | Claude Code |
| 2026-07-27 | v0.1 | 初版 DRAFT — 解 OQ-FTP-6 / OQ-PM-1 之共同阻塞。落地既有決策(docs/11 §3.6 R2 + §16 避 lock-in → S3-compatible 抽象 + local 驅動;docs/22 上傳安全鐵則逐條對照)。P0 = 驅動抽象 + 上傳/下載端點 + file_object(RLS)+ 兩階段綁定 + 配額 + attachment 欄完成;病毒掃描/presigned/縮圖/範本上傳/image·signature 欄 → P1。OQ-FS-1..7 待裁定 | Claude Code |
