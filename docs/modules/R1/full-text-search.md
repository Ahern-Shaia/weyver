# full-text-search.md — [R1·H-3] 跨表全文搜尋設計文件

> ✅ **狀態:SHIPPED v1.0(2026-07-31)— OQ-FTS-1..6 全採建議**
> **緣起**|docs/25 §247 之下一批;§173 現況「⌘K 僅搜表單名 / 固定動作(client-side)· **跨表記錄全文搜尋未起**」,人月 3。
> **五個硬約束**|繁體中文為主 · prod 為 **Cloud SQL managed PG**(能否裝擴充是關鍵)· **OSS-only** · 多租戶 shared schema + **RLS FORCE** · **動態 schema**(使用者自建表,執行期建真實 PG 表)。另有**欄位級權限**(同筆記錄不同角色可見欄位不同)。
> 作者:Claude Code(草擬)

---

## 0. 研究與實測

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

→ **那不是搜尋,是等值比對。** PG 內建 15 種語言設定**不含中日韓**。

**(b) `pg_trgm` 的相似度對中文無效,但 `LIKE` 可走索引 —— 有 3 字門檻**

`similarity('食品','大成食品股份有限公司')` = **0**(`%` 運算子對中文子字串無效),但 `ILIKE '%食品%'` = true。兩者走**不同路徑**:GIN trigram 索引可加速 `LIKE`。

實測 200K 筆,建 `gin_trgm_ops` 索引後:

| 搜尋詞 | 字數 | 索引 | 耗時 |
|---|---|---|---|
| 食品 / 鋼板 | **2** | ❌ **退回全表掃描** | 44–51ms |
| 食品股 | 3 | ✅ | 17ms |
| 不鏽鋼管 | 4 | ✅ | 12ms |

🔴 **中文最常見的搜尋詞正好是兩個字**(食品 / 鋼板 / 螺栓 / 單號)。trigram 需要 3 字元才湊得出完整 trigram,**故最常用的情境退化成全表掃描**。20 萬筆 50ms 尚可忍,再上去就不行。

**(c) 🔴 `pg_bigm` 解掉 2 字門檻 —— 本題的轉折點**

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
| **`pg_bigm`** | ✅ **支援** | 「Enables full-text search, and allows a two-gram (bigram) index for faster full-text search」;需先設 `cloudsql.enable_pg_bigm` = on |
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
| S5 | 大租戶搜尋拖垮 DB | P1 | 1000 筆上限 + 2 字門檻 + LIKE 萬用字元轉義 | ⚠️ 部分 —— 上限與門檻已做(前後端同源);**`statement_timeout` 未設於此路徑**(見 §8) |
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
| R1 | 既有資料 backfill + 對帳 job | 同 tx 寫入已覆蓋所有寫入路徑;既有資料的一次性補寫屬 pilot 上線前營運步驟。**pilot 前必做** |
| R2 | 搜尋路徑的 `statement_timeout` | 1000 筆上限 + 2 字門檻已擋掉主要的失控來源;真正需要它是在單一租戶資料量級提升後 |
| R3 | GIN 寫入延遲量測(`fastupdate` / `gin_pending_list_limit` 調校)| 目前每筆記錄僅數列 upsert;**沒量過就不該調參**,調了也不知道有沒有效 |
| R4 | 批次匯入的索引寫入效能 | Excel 匯入走 bulk 路徑,逐筆 upsert 在大批量下會放大;需與 grid-and-excel-import 一起看 |
| R5 | virtual 欄位(lookup / rollup)可搜 | 需要依賴失效機制,規模等同另一個模組 |
| R6 | 相關性排序(BM25 或等價)| 現為自建啟發式;**若哪天真的需要相關性,那才是重新評估外部引擎的時機**(見 §0.4) |
