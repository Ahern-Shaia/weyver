# full-text-search.md — [R1·H-3] 跨表全文搜尋設計文件

> ✅ **狀態:SHIPPED v1.0(2026-07-31)— OQ-FTS-1..6 全採建議**
> **緣起**|docs/25 §247 之下一批;§173 現況「⌘K 僅搜表單名 / 固定動作(client-side)· **跨表記錄全文搜尋未起**」,人月 3。
> **五個硬約束**|繁體中文為主 · prod 為 **Cloud SQL managed PG**(能否裝擴充是關鍵)· **OSS-only** · 多租戶 shared schema + **RLS FORCE** · **動態 schema**(使用者自建表,執行期建真實 PG 表)。另有**欄位級權限**(同筆記錄不同角色可見欄位不同)。
> 作者:Claude Code(草擬)

---

## 0. 研究與實測

> **可重跑的驗證位置**(2026-08-06 補 —— 原本一條路徑都沒寫):
> 索引寫入 `apps/api/src/search/search-index.service.ts` ·
> 回填 `apps/api/src/search/search-backfill.service.ts` ·
> 整合測試 `apps/api/test/search.integration.test.ts` 與 `search-backfill.integration.test.ts` ·
> `pg_bigm` 的映像建置 `docker/postgres/Dockerfile`。
> ⚠️ **實測沒有寫下「在哪裡可以重跑」,別人一樣回查不到** —— 與外部研究沒放 URL 是同一件事。

### 0.1 🔴 本機實測:繁中在原生 PG 的真實行為

> **方法**|本機 PG 16.13(`weyver-pg`),200,000 筆繁中資料(品名 / 供應商 / 批號)。
> **這一節全部是實測,不是引用** —— 因為官方文件不會告訴你中文的字數門檻。

**(a) PG 內建全文搜尋對繁中基本不可用**

```
to_tsvector('simple','大成食品股份有限公司 鋼板 SS400 3mm')
  → '3mm':4 'ss400':3 '大成食品股份有限公司':1 '鋼板':2
```

整串中文變成**單一 token**。實測:

| 查詢 | 結果 |
|---|---|
| 搜「食品」 | **false** —— 搜不到 |
| 搜「大成食品股份有限公司」(完整) | true |

→ **那不是搜尋,是等值比對。**

🔴 **2026-08-06 更正 + 補可回查的驗法**:原文寫「PG 內建 **15 種**語言設定不含中日韓」——
數字不對,而且沒說怎麼驗。**直接對本專案的 PG 16.13 查**(任何人都能重跑):

```sql
SELECT string_agg(cfgname, ', ' ORDER BY cfgname) FROM pg_ts_config;
```
> arabic, armenian, basque, catalan, danish, dutch, english, finnish, french, german,
> greek, hindi, hungarian, indonesian, irish, italian, lithuanian, nepali, norwegian,
> portuguese, romanian, russian, serbian, **simple**, spanish, swedish, tamil, turkish, yiddish

**29 個(含 `simple`),中日韓一個都沒有。** 結論不變,但數字要對、而且要說得出怎麼查。
⚠️ **對自家資料庫下一句 SQL,比引一段官方文件更強** —— 它連版本差異都一起答了。

**(b) `pg_trgm` 的相似度對中文無效,但 `LIKE` 可走索引 —— 有 3 字門檻**

`similarity('食品','大成食品股份有限公司')` = **0**(`%` 運算子對中文子字串無效),但 `ILIKE '%食品%'` = true。兩者走**不同路徑**:GIN trigram 索引可加速 `LIKE`。

為什麼是 3 字元 —— [PostgreSQL `pg_trgm` 官方](https://www.postgresql.org/docs/16/pgtrgm.html)逐字:
> A trigram is **a group of three consecutive characters** taken from a string.
> Each word is considered to have **two spaces prefixed and one space suffixed** when determining the set of trigrams.

英文靠那三個補白湊得出 trigram(`"cat"` → `" c"`, `" ca"`, `"cat"`, `"at "`),
但**中文詞之間沒有空白**,兩字詞在長字串中間取不到完整 trigram —— 這正是下表的成因,
不是實作沒調好。

實測 200K 筆,建 `gin_trgm_ops` 索引後:

| 搜尋詞 | 字數 | 索引 | 耗時 |
|---|---|---|---|
| 食品 / 鋼板 | **2** | ❌ **退回全表掃描** | 44–51ms |
| 食品股 | 3 | ✅ | 17ms |
| 不鏽鋼管 | 4 | ✅ | 12ms |

🔴 **中文最常見的搜尋詞正好是兩個字**(食品 / 鋼板 / 螺栓 / 單號)。trigram 需要 3 字元才湊得出完整 trigram,**故最常用的情境退化成全表掃描**。20 萬筆 50ms 尚可忍,再上去就不行。

**(c) 🔴 [`pg_bigm`](https://pgbigm.osdn.jp/pg_bigm_en-1-2.html) 解掉 2 字門檻 —— 本題的轉折點**

> [官方](https://pgbigm.osdn.jp/pg_bigm_en-1-2.html)逐字:pg_bigm「provides **2-gram** (bigram) index」——
> 相對於 `pg_trgm` 的 3-gram,**2-gram 正好對上中文最常見的兩字詞**。
> 這不是調參可以解決的差異,是索引單位本身不同。

於容器內自 v1.2-20240606 原始碼編譯安裝後實測(同一份 200K 資料):

```
show_bigm('食品公司') → {" 食", 公司, "司 ", 品公, 食品}
```

| 搜尋詞 | trigram | **bigram** |
|---|---|---|
| 食品 | 全表掃描 ~50ms | **索引 4.6ms** |
| 鋼板 | 全表掃描 ~44ms | **索引 4.8ms** |
| 螺栓 | — | **索引 4.6ms** |

⚠️ **planner 自選驗證**|上表首次量測用了 `enable_seqscan=off` **強制**走索引;**拿掉提示重測,planner 仍自行選用 bigm 索引**(4.7–18.6ms)。若不做這一步,等於「測試因為錯的理由通過」。

### 0.2 Cloud SQL 擴充支援(**回一手查證**)

> 這是決定整個架構的載重論據,故直接查官方頁面而非採信轉述。

| 擴充 | Cloud SQL | 官方逐字描述 |
|---|---|---|
| **`pg_bigm`** | ✅ **支援** | [Cloud SQL 擴充清單](https://cloud.google.com/sql/docs/postgres/extensions)逐字:「Enables full-text search, and allows a two-gram (bigram) index for faster full-text search」;需先設 `cloudsql.enable_pg_bigm` = on |
| `pg_trgm` | ✅ 支援 | 「…based on trigram matching…」 |
| `pgroonga` · `zhparser` · `pg_jieba` · `pg_cjk_parser` | ❌ **清單未列 = 不可用** | — |

→ **中文分詞類擴充在 managed PG 上全數裝不了,但 `pg_bigm` 可以。** 這使繁中全文搜尋能**完全留在 Postgres 內**,`FORCE ROW LEVEL SECURITY` 原封不動繼續執法,**不必新增信任邊界**。

⚠️ **一個過時說法的更正**|PGroonga 對照頁稱「pg_trgm disables non ASCII characters support」。查現行 PG 原始碼 `contrib/pg_trgm/trgm.h` **已無 `KEEPONLYALNUM`**,只剩多位元組感知的 `ISWORDCHR`。該說法是 **PG 9.6 時代狀態,已過時**。真正的限制不是「不支援中文」而是**3 字門檻**(見 0.1b 實測)。

### 0.3 競品做法

**Ragic**〔官方明載〕|底層為 **Lucene**。三個值得抄的取捨:
1. **非即時索引**:「You might not be able to find your record via the search engine **right after creating** a new record」,提供手動重建。
2. **欄位級權限的解法 = 乾脆不索引**:「if a field on a Form Page is set as **Hidden** … the content of that field **cannot be searched**」。
3. 搜尋範圍:首頁搜尋涵蓋「**all the sheets that you have Access Right to**」;表內搜尋只限該表。另有 **1000 筆結果上限**與布林語法。

**Baserow**〔官方 issue,第一手 —— 最有價值的反面教材〕|現況每欄配一個 tsvector 欄,自陳失敗:
> 「It **doubles the number of columns** per table, and in some cases, we've already hit PostgreSQL's **column limit of 1600**」·「Keeping TSV columns up to date using **Celery tasks has proven fragile**」·「increases the likelihood of **deadlocks**」·「the columns can become **out of sync**, leading to inaccurate search results」

🔴 **動態 schema 逐欄索引是死路,已有人替我們撞過。**
另揭露用量:「**less than 1% of requests involve a search**」、「only **0.3% of tables** have more than 10k rows」。

**NocoDB**|**明確只做單表**內跨欄位搜尋;跨表全域搜尋是多年未實作的 feature request(#5970 / #10463 / #8763)。→「不做跨表」的先例確實存在。

**Teable / Airtable**|查不到公開實作說明。

### 0.4 外部搜尋引擎

| 引擎 | 授權 | 中文分詞 | 多租戶 | **欄位級權限** |
|---|---|---|---|---|
| Meilisearch | MIT | ✅ Charabia 內建 jieba | Tenant Tokens | ❌ **官方明載不支援**(「The only rule available in the `searchRules` object is the search parameter **filter**」)|
| Typesense | GPL-3.0 | ✅ 需逐欄設 `locale: "zh"` | Scoped API Keys | ✅ 官方明載可內嵌 `exclude_fields` |
| OpenSearch | Apache 2.0 | CJK analyzer 僅 bigram;真分詞需 plugin | index/alias + FGAC | ✅ 但 ops 重 |
| Quickwit | Apache 2.0 | 有 CJK tokenizer | 需自建 | 2025-01 **被 Datadog 併購**,solo 維運風險 |

🔴 **共同的根本問題**:引入外部引擎後 **RLS 不再執法**,租戶隔離由「DB 層已驗證的防線」降級為「應用層記得簽對 token」。對本專案而言,**跨租戶洩漏是最高風險**(見 `pitfall_privileged_lane_masks_security` —— 本專案已在同類問題上栽過五次)。

---

## 1. 目標與範圍

### 1.1 目標
跨表搜尋記錄內容,以**使用者有權限的表**為邊界(對齊 Ragic),繁中 2 字查詢可走索引。

### 1.2 不做的事
- **不引入外部搜尋引擎**(§0.4:用最高風險換 <1% 請求量的價值)。
- **不做逐欄 tsvector**(§0.3 Baserow 已實證撞 1600 欄上限)。
- **不做 BM25 相關性排序** —— pg_bigm 是 `LIKE` 加速非評分引擎;排序自建(見 §2.3)。
- 不做錯字容忍 / 同義詞 / 拼音搜尋。

---

## 2. 設計要點

### 2.1 集中式 `search_doc`(Tier-1 固定表)

grain = `(tenant_id, form_id, record_id, field_id, value_text)`,**一列一欄位值**。

- `USING gin (value_text gin_bigm_ops)` —— 繁中 1–2 字直接走索引
- 另建 `gin_trgm_ops` 給英數料號(`CHO331344-GERMANY` 這類);pg_bigm 官方明載 1.1+ **可與 pg_trgm 共存**
- **RLS FORCE 直接套在 `search_doc`** —— 租戶隔離用既有機制,**零新風險**
- 跨表搜尋 = 對**單一表**查詢後 `GROUP BY record_id`,**無 UNION fan-out**,表增減不動 DDL

### 2.2 🔴 欄位級權限:pre-filter 而非事後過濾

`WHERE field_id IN (該角色可見欄位)`。**必須在查詢內**,不可查完再濾 —— 否則「這筆記錄存在」本身即為洩漏(可由結果筆數反推)。
→ 此點**優於 Ragic 的「隱藏欄乾脆不索引」**:我方隱藏欄仍可被有權者搜到。

### 2.3 排序(自建,非 BM25)
完全命中 > 前綴命中 > 子字串,再加「命中內容佔整個欄位值的比例」。**誠實標注:此為自訂啟發式,無外部依據。**
> 實作差異|原擬納入的「欄位權重(標題類 > 一般欄)」未做 —— 目前沒有「標題欄」這個概念可依據,
> 硬指一個等於憑空發明語意。新近度亦未納入(`updated_at` 在索引表上是**索引列**的時間非記錄的時間)。

### 2.4 索引維護
**同 tx 寫入 `search_doc`**(單列 upsert,成本可忽略)。
> 實作差異|**outbox backfill 未做**。理由:同 tx 寫入已覆蓋所有既有寫入路徑(建 / 改 / 刪 / 還原),
> 尚未出現「索引落後」的來源;既有資料的一次性 backfill 屬 pilot 上線前的營運步驟,不是常駐機制。
> 先做等於維護一條沒有輸入的管線。**留為殘留項**(見 §8)。

### 2.5-bis 🔴 可搜尋型別由型別註冊表推導,不手寫

由 `FIELD_TYPE_REGISTRY` 篩「`dbFieldType` 為 `text` / `text_array` 且非 virtual」。
**這一條是被實作打出來的**:首版手寫清單含 `textarea` / `richText`,兩者**都不是本專案的型別**
(真正的長文字叫 `longText`)→ 備註 / 說明這類最該被搜尋的欄位靜默地從未進索引,
而型別參數是 `string` 不是 union,型別檢查完全抓不到。

virtual(`lookup` / `rollup` / `createdBy`…)刻意排除:讀時計算,沒有任何寫入路徑會通知索引更新,
索引下去保證過期。要搜這些欄位得先有依賴失效機制 —— 那是另一個模組的規模。

### 2.5 ⚠️ dev / prod 一致性(實作前必解)
`pg_bigm` **不在 `postgres:16-alpine` 內**,本次係於容器內自原始碼編譯。
→ 需自建 dev image 或改用內含 pg_bigm 的映像,否則 **dev 與 prod 行為分歧** —— 本專案已多次栽在此類分歧(`pitfall_privileged_lane_masks_security`)。

---

## 3. 開放問題(OQ-FTS-N)— 待裁定

| # | 問題 | 選項 | 建議 |
|---|---|---|---|
| **1** | 搜尋後端 | A **pg_bigm + search_doc** · B 應用層分詞存 tsvector · C 外部引擎(Typesense)· D 只做單表(NocoDB 式) | **A** —— 實測 2 字查詢 4.6ms;**RLS 不動、無新信任邊界**;Cloud SQL 官方支援。B 有分詞不一致風險(寫入切「鮮乳/飲品」,搜「乳飲」0 筆);C 用最高風險換 <1% 請求量 |
| **2** | 搜尋範圍 | A **有權限的表(Ragic 式)** · B 全租戶 · C 僅當前表 | **A** —— 對齊遷移客戶既有心智;B 會洩漏無權表的存在 |
| **3** | 即時性 | A **同 tx 寫入** · B 非同步(秒級)· C 手動重建 | **A** + outbox 補 backfill —— 單列 upsert 成本可忽略;Ragic 用 C 但那是 Lucene 的限制,非我方 |
| **4** | 隱藏欄是否索引 | A **索引但查詢時 pre-filter** · B 不索引(Ragic 式) | **A** —— 有權者仍搜得到,較 Ragic 完整;安全性由 pre-filter 保證 |
| **5** | 結果上限 | A **1000 筆 + 提示縮小範圍**(Ragic 式)· B 無上限分頁 | **A** —— 無上限的跨表查詢是壓垮 DB 的路徑 |
| **6** | dev image | A **自建含 pg_bigm 的 image** · B 改用第三方映像 | **A** —— B 引入供應鏈風險;A 可控且 Dockerfile 進版控 |

---

## 4. 落地順序(實況)

| M | 內容 | 驗證 | 結果 |
|---|---|---|---|
| M1 | dev image 含 pg_bigm + migration 建 `search_doc` + RLS/grant | 真 PG 斷言 RLS 生效 | ✅ `4719cda` |
| M2 | 寫入路徑(同 tx upsert)| 建/改/刪/還原後索引一致 | ✅ `1b972b3`(outbox backfill 未做,見 §2.4)|
| M3 | 查詢 API(權限 pre-filter + 排序 + 1000 上限)| 跨租戶 + 欄位級權限 | ✅ `1b972b3` |
| M4 | ⌘K 接跨表搜尋 | 瀏覽器實走 | ✅ `317504d`(後端修)+ `6c42703`(前端)|
| M5 | FMEA + docs 回填 | — | ✅ 本節 |

### 4.1 🔴 實作階段抓到的三個「不報錯但完全不動」

三者都通過 type-check、lint、既有整合測試,**只有真的打那條路由才會顯形**
(同 [public-form.md](public-form.md) 之教訓:靜態防線攔不住「接起來才會炸」的錯)。

| # | 失效 | 為什麼靜態檢查與既有測試都抓不到 | 修法 |
|---|---|---|---|
| 1 | **`SearchService` 未進租戶交易 → API 一律回空** | 既有測試直接對 `search_doc` 下 SQL,**繞過 service 本身**;而失效不拋錯,app 車道回空、特權車道回全部租戶 —— 兩種結局都很安靜 | 查詢包進 `set_config('app.tenant_id')` 的交易;**補「建表→建記錄→呼叫 service」端到端段**(走 `app_login` 非特權角色) |
| 2 | **可搜尋型別清單含兩個不存在的型別名** | 型別參數是 `string` 不是 union;`longText` 缺席只表現為「備註欄搜不到」,沒有任何錯誤 | 改由 `FIELD_TYPE_REGISTRY` 推導(§2.5-bis)+ 對真實 `CELL_VALUE_TYPES` 斷言 |
| 3 | **controller 路徑多一層 `engine`** | 後端自己看是通的;web rewrite 已把 `/api/engine/*` 映到 `/api/*`,疊起來才是 404 | 對齊其餘 20 個 controller 為 `api/search` |

**反向驗證**|拿掉租戶交易 → 正好新增的 4 條端到端測試轉紅、原 13 條全綠,
證實**舊測試確實測不到那一層**(不是「湊巧沒抓到」,是結構上抓不到)。

### 4.2 RLS 三層語意(反向驗證時釐清,寫下以免日後誤解)

- `ENABLE` → **非 owner** 受 RLS 管(`weyver_app` 即靠這層)
- `FORCE` → **連 owner 也受管**(防「應用不慎以 owner 連線」)
- superuser / `BYPASSRLS` → **兩者皆無效,完全繞過**

單獨移除 `FORCE` 時隔離測試**仍全綠**,因為測試走 `weyver_app`(非 owner),`ENABLE` 就夠了;
而 testcontainer 的預設使用者實測為 **superuser + BYPASSRLS**,無法用它示範 `FORCE`。
→ 已把「測試方法本身的前提」也釘成一條斷言,預設使用者哪天不再是 superuser 就會提醒重新檢視。

## 5. FMEA(M5 完成)

| # | 失效 | 嚴重度 | 緩解 | 狀態 |
|---|---|---|---|---|
| S1 | 搜尋結果洩漏他租戶資料 | **P0** | RLS FORCE 套 `search_doc` + 查詢在租戶交易內 | ✅ 已緩解 —— api 三條(含無 WHERE 全表查詢兜底、`WITH CHECK` 防偽造寫入)+ 端到端一條(乙租戶**自備資料**,免得因「沒資料」而假綠)+ e2e 一條 |
| S2 | 由結果筆數反推無權欄位 / 記錄存在 | **P0** | `form_id IN (可讀表)` 與 `field_id NOT IN (隱藏欄)` 皆寫進 WHERE | ✅ 已緩解 —— api 兩條(含「有權者仍搜得到」的反面,證明不是靠「一律不索引」) |
| S3 | `search_doc` 與來源表不同步(Baserow 之痛)| P1 | 同 tx 寫入;硬刪連帶清 | ✅ 主路徑已緩解 —— 建/改/刪/還原四條路徑接上;**殘留**:既有資料 backfill 與對帳 job(見 §8) |
| S4 | dev 無 pg_bigm 致行為分歧 | P1 | 自建 image 進版控 + 測試映像共用常數 | ✅ 已緩解 —— `docker/postgres/Dockerfile` 建置期驗證擴充檔存在;48 個整合測試統一走 `weyver-postgres:16-bigm`,**刻意 fail-closed**(映像不存在直接報錯,好過靜默跳過擴充而在與 prod 不同的環境下通過) |
| S5 | 大租戶搜尋拖垮 DB | P1 | 1000 筆上限 + 2 字門檻 + LIKE 萬用字元轉義 + `statement_timeout` 5s | ✅ ~~部分~~ —— **2026-08-04 更正**:逾時已於 2026-08-03 完成(§8 R2 那一列早就記了),但這一列沒跟著改。**同一份文件裡兩節互相矛盾** |
| S6 | GIN 寫入放大影響記錄寫入延遲 | P1 | 單值上限 2000 字元 | ⚠️ 未量測 —— 值截斷已做,但**寫入延遲前後對比未量**(見 §8) |
| S7 | **`search_doc` 無限長大** | P1 | 記錄硬刪連帶清該筆、表硬刪連帶清整張 | ✅ 已緩解(本次補) —— 原 `removeFormInTx` **定義了卻沒人呼叫**;**保留期內刻意不清**,還原時索引原封不動不必重建。反向驗證:拿掉清除呼叫,回收桶測試轉紅 |

## 6. 測試

| 層 | 數量 | 覆蓋 |
|---|---|---|
| api 整合(真 PG + pg_bigm)| 21 | 繁中行為(PG 內建對繁中無效 / bigram 切詞)· 型別推導三條 · 索引寫入三條 · **S1 五條** · **S2 兩條** · 服務層端到端五條(含 longText、跨表、刪除後消失)|
| api 回收桶 | 1 | 保留期內索引仍在 → 硬刪後清空 |
| web e2e | 4 | 跨表命中可導向該筆 · 繁中 2 字搜出兩張表 · 1 字不送請求(攔網路請求驗證)· 切租戶隔離 |

## 7. 與 Ragic 的差異(對遷移客戶說明用)

| 項目 | Ragic | Weyver |
|---|---|---|
| 隱藏欄 | 乾脆不索引 → 有權者也搜不到 | **索引但查詢時 pre-filter** → 有權者搜得到,無權者連筆數都推不出來 |
| 即時性 | 非即時(Lucene 限制)| **同 tx**,建完立刻搜得到 |
| 範圍 | 有權限的表 | 同 |

## 8. 殘留(不阻擋 v1.0)

| # | 項目 | 為什麼可以先不做 |
|---|---|---|
| ~~R1~~ ✅ | ~~既有資料 backfill + 對帳 job~~ | **已完成(2026-08-01)** —— 見 §9 |
| ~~R2~~ ✅ | ~~搜尋路徑的 `statement_timeout`~~ | **已完成(2026-08-03)** —— 5s。交易 + 租戶 GUC + 逾時綁在同一個 helper(分開放的話漏掉任何一件都不會拋錯:漏 GUC 是靜默洩漏、漏逾時是靜默變慢)。逾時轉 `SEARCH_TIMEOUT` 並給可行動的訊息,不讓 PG 的 `canceling statement` 冒到前端 |
| ~~R3~~ ✅ | ~~GIN 寫入延遲量測 / `fastupdate` 調校~~ | **量測完成,結論是「不要調」(2026-08-03)** —— 見 §10 |
| ~~R4~~ ✅ | ~~批次匯入的索引寫入效能~~ | **它不是效能問題,是根本沒寫索引(2026-08-03)** —— 見 §10 |
| R5 | virtual 欄位(lookup / rollup)可搜 | 需要依賴失效機制,規模等同另一個模組 |
| R6 | 相關性排序(BM25 或等價)| 現為自建啟發式;**若哪天真的需要相關性,那才是重新評估外部引擎的時機**(見 §0.4) |

---

## 9. 既有資料補寫(殘留 R1,2026-08-01 完成)

### 為什麼這是 pilot 硬前提

索引是同 tx 寫入的,四條寫入路徑都會維護它 —— **但那只涵蓋功能上線之後的寫入**。
上線前就存在的記錄從未經過那些路徑,因此完全搜不到。

對 pilot 客戶而言這是最糟的失敗形態:功能看起來好好的(新建的搜得到),
但**歷年的資料一筆都搜不到**,而且沒有任何錯誤訊息。

### 交付

`SearchBackfillService` + CLI:

```
pnpm --filter @weyver/api search:backfill -- --tenant 1 --check   # 只對帳,不寫
pnpm --filter @weyver/api search:backfill -- --tenant 1           # 補缺的
pnpm --filter @weyver/api search:backfill -- --tenant 1 --force   # 全部重寫
```

| 性質 | 做法 |
|---|---|
| 分批可續跑 | 逐表單、逐批 500 筆各自成一交易 —— 中斷不回滾已完成的部分 |
| 冪等 | 沿用索引寫入的 `onConflict … merge`;預設跳過已有索引者 |
| **不另寫解析邏輯** | 直接呼叫 `SearchIndexService.upsertInTx`,與線上寫入**同一段程式碼** —— 兩份對「什麼算可搜尋」的判斷遲早分岔,而本模組已經踩過一次(手寫型別清單裡有兩個不存在的型別) |
| 對帳**無副作用** | `--check` 只讀不寫。若它順手補掉,上線前的檢查腳本會永遠看起來是通過的 |

### 實跑結果(dev,真實既有資料)

`--check` 抓出 **27 張表單、254 筆記錄未進索引** → 補寫 240 筆(約 1 秒)→ 再 check 回報「索引完整,無缺漏」→ 重跑補 0 筆(冪等)。
搜尋 API 實測:補寫前搜不到的值(`冷凍雞腿` / `PO-003`)補寫後即命中。

### 🔴 兩個實作期才發現的形狀問題

1. **`field_def` 的型別欄叫 `cell_value_type` 不是 `type`**,實體欄名是 `f<id>` 不是欄位名稱。
   索引寫入吃的是**以欄位名稱為鍵**的物件 —— 直接把實體列丟進去的話,每個欄位都查到 `undefined`
   → 被當成「值已清空」→ **一筆都不會進索引,而且不報錯**。
2. **knex 對 bigint 回傳字串**(drizzle 有 `mode:"number"` 幫忙轉,knex 沒有)。
   未轉的 `field_def.id` 會被 `physicalColumnName` 的 `Number.isSafeInteger` 擋下並拋
   `illegal fieldId`;而 `form_def.id` 未轉則讓 `formId === xxx` 這種比較**靜默失敗**。

### 順帶查證(非缺陷)

軟刪表單的索引列**不會被清掉**,但搜尋只在 `metadata.listForms` 回傳的(未刪)表單裡找,
故查不到 —— 實測 dev 有 100 列 `鮮勇…` 屬已刪表單,搜尋正確回 0。
保留這些列反而讓「從回收桶還原表單」立即可搜,不必重跑 backfill。

---

## 10. 殘留 R2 / R3 / R4 收尾(2026-08-03)

### 🔴 R4 的真相:批次匯入從來沒寫過索引

原本把 R4 記成**效能**問題(「逐筆 upsert 在大批量會放大」)。對碼後發現不是量的問題:

| 寫入路徑 | 是否寫索引(修正前) |
|---|---|
| `createRecord`(單筆填單) | ✅ |
| `updateRecord` / `softDeleteRecord` / `restoreRecord` | ✅ |
| **`createManyRecords`(Excel 匯入、批次貼上)** | ❌ **完全沒有** |
| **`saveWithLines`(主檔 + 明細)** | ❌ **完全沒有** |

對遷移中的客戶,那兩條路徑寫進去的**就是他的全部資料**。沒有錯誤訊息,
只有「用表單新建的搜得到、匯入的搜不到」—— 正是本模組 §9 說的最糟失敗形態,
只是 §9 把它歸因為「上線前的舊資料」,而實際上它是**持續在漏**。

**它為什麼躲得掉**|單筆與批次共用 `insertOne` 卻**不共用索引寫入**,
而沒有任何一條測試對批次路徑斷言過搜尋結果。dev 實跑 `--check` 是決定性證據:
未索引的表單名清一色是 `E2E匯入…` 與子表的主檔 / 明細。

**修正**|批次走新的 `upsertManyInTx`(單句多列 upsert + 5000 列分段 ——
PG 單句 65535 個綁定參數上限,一列 6 欄約 10900 列,不分段會在大匯入時直接爆);
`saveWithLines` 走逐筆版(明細會被**更新**,值清空時要連帶刪舊索引列,
而批次版刻意不處理那件事),並補上「被移除的明細要移出索引」。

### 🔴 對帳是恆紅的假警報

`countMissing` 只看「這筆記錄有沒有索引列」。但**可搜欄位全空的記錄本來就寫不出索引列** ——
dev 的 form #12 唯一可搜欄位是 barcode 且三筆全空,於是:補寫 → 對帳 → 再補寫,永遠不會歸零,
CLI 也永遠 `exit 1`。恆紅的檢查等於沒有檢查,真正的缺漏會藏在那片噪音裡。

改為取出候選列後,以**與寫入端同一段判斷**(`SearchIndexService.hasIndexableContent`,
共用 `normalize`)過濾;`indexed` 計數同樣改成只數真的寫出列的那些,
否則日誌會宣稱「補寫 3 筆」而其實什麼都沒變。修正後 dev `--check` 回「索引完整,無缺漏」。

### R3 量測:預設值已經是對的,調了會更慢

本機 PG 16(dev),`search_doc` 同構表 + 同樣兩個 GIN,2000 筆逐筆 upsert:

| 設定 | 寫入 2000 筆 | 每筆 |
|---|---|---|
| 無 GIN(對照) | 51 ms | 0.026 ms |
| 2× GIN,`fastupdate=on`(**預設**) | **274 ms** | 0.137 ms |
| 2× GIN,`fastupdate=off` | **1179 ms** | 0.590 ms |

讀取側(pending list 未 flush 時最不利):`%食品%` 6.6 ms / `%CHO1999%` 1.4 ms;
`fastupdate=off` 對應 1.4 ms / 0.6 ms。

**結論:不調**。關掉 `fastupdate` 會讓寫入**慢 4.3 倍**,換來的是讀取側省下數毫秒 ——
在本專案「寫多讀少、且讀取本來就有 5s 預算」的形狀下完全不划算。
GIN 相對無索引的寫入成本是 +0.11 ms/筆,對比一次記錄寫入要做的其他事(動態表 insert、
公式重算、事件、稽核)可忽略。**日後要重看的觸發條件是讀取延遲、不是寫入延遲** ——
`fastupdate` 的代價本來就出現在讀那一側。

⚠️ 量測限於本機單機、2000 筆、單一 value 形狀,不等於生產環境;
記錄下來是為了讓下一個人知道**已經量過什麼、結論從哪來**,而不是當成通用結論。
