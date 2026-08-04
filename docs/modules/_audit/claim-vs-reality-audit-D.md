# claim-vs-reality-audit-D.md — 「宣稱 vs 使用者走得到的路徑」稽核(全 35 份)

| | |
|---|---|
| 稽核日期 | 2026-08-04 |
| 範圍 | `docs/modules/R1/` **全部 35 份** |
| 判準來源 | `AGENTS.md`〈🚫 第一約束:不用寫 code〉· `memory/pitfall_stale_design_doc_claims` · `pitfall_unread_schema_field_drift` · `pitfall_stale_todo_already_done` |
| 方法 | 四組平行稽核各 8–9 份;**所有 🔴 由本人回程式碼一手複驗**(不採信轉述)|
| 產出性質 | 稽核;**未動任何 prod 邏輯與文件** |

---

## 0. 為什麼換一個軸

A/B/C 三輪查的是**證據品質**(設計決策有沒有一手依據),而 C 自己的結論是
「33 份裡 30 份的第③站達到一手逐字」——**形式面已經好了**。

但同一天的實作連續撞到**另一類**問題,而那一類三輪都沒查:

| 形狀 | 當日實例 |
|---|---|
| **已裁定但沒做到** | `fieldLayoutSchema.sectionId` **零 reader 零 writer**,存在兩個月 |
| **已出貨但使用者碰不到** | 簽核人 `fieldRef` 後端出貨、doc 寫「✅ 已落地」,而設計器裡**沒有這個選項** |
| **宣稱指向不存在之物** | doc 寫某風險「已列為 SOP 的必填項」,而當時**沒有任何 SOP 文件** |
| **假綠 / 空的斷言** | 整合測試漏傳 `expectedVersion`,400 與「被規則擋下」長得一樣;e2e 負向斷言比對的字串在舊版根本不存在 |

**共同點:文件是對的,程式也在跑,但兩者之間有一段沒有人走過。**
本輪即以此為軸。

---

## 1. 一句話結論

**35 份裡有 6 條真缺口,而其中 5 條的形狀完全一樣:後端做完了、schema 有了、文件標了 ✅,但使用者在瀏覽器裡碰不到,或碰到的是壞的。**

最貴的一條是 `view_def.config`:**使用者設好的分組與小計,按下「另存」之後靜默消失** ——
前端 schema 有 `groupBy` / `aggregates`,後端沒有,zod 直接 strip。

---

## 2. 🔴 六條(逐條本人複驗)

### 2.1 儲存檢視會**靜默丟掉**分組與小計

| | |
|---|---|
| 模組 | `views-group-kanban-calendar` · `views-list` |
| 證據 | 前端 `apps/web/src/lib/engine/schemas.ts:252-257` 的 `viewConfigSchema` 有 `groupBy` + `aggregates`;後端 `apps/api/src/views/view-specs.ts:29-36` **兩個都沒有** |
| 路徑 | `list-controls.tsx:74` 使用者加分組 → `form-workspace.tsx:149` `createView.mutate({ config: workingConfig })` → 後端 zod **非 strict,未知鍵直接 strip** |
| 後果 | 存了、回來是空的。**使用者每次進頁都要重設**;共通檢視更帶不動 |
| 為什麼沒被抓到 | `views.spec.ts:63` 只斷言「檢視出現在選擇器」,**沒有任何 config round-trip 斷言** |

⚠️ 該模組 §2 現況走查**逐字寫著**「`view_def.config` 加 `group` / `kanban` / `calendar` 子物件(加法,零 migration)」——
**已裁定,沒做到。** 看板分欄與行事曆日期欄更是元件 local state(`kanban-board.tsx:23`、`calendar-view.tsx:48`),完全不寫回。

### 2.2 連結欄在記錄頁顯示的是**原始 id**

| | |
|---|---|
| 模組 | `link-picker-and-load` |
| 證據 | `apps/web/src/components/form/value.ts:104` `formatFieldValue` 有 `member` 的名稱查表分支(`:112-115`),**沒有 `link`** → 落到 `displayValue` 顯示原值 |
| 對照 | 同一檔 `:61` 的 `toSubmitValue` **有** `case "link"` —— 送出面修了,**顯示面沒修** |
| 文件 | §7 逐字「✅ 已出貨:候選端點 + 選記錄 UI + **可讀顯示**」;§2 走查也逐字列這一條為「M1 要修」 |
| 護欄 | FMEA L2 的緩解寫「e2e 斷言不得為純數字」,而 `link-picker.spec.ts:55` 只斷言**選擇器**內含標題,`:91` 反而斷言 API 值 `toMatch(/^\d+$/)`(儲存面)。**顯示面零覆蓋** |

### 2.3 `showAsQr` **零 writer** —— 文字欄無法設成條碼顯示

| | |
|---|---|
| 模組 | `print-merge` |
| 證據 | `apps/web/src/lib/engine/barcode.tsx:16` 讀;`apps/api/.../field-type-registry.ts:269` 定義。**全 repo 無任何寫入處** |
| 文件 | §4.2、M2 里程碑、changelog v1.0 皆逐字寫「text 欄 `showAsQr`」已落地 |
| 判準 | 第一約束逐字:「有 API 可以做」不算解決 |

### 2.4 `displayMask` 與**連動選項**只有 schema

| | |
|---|---|
| 模組 | `field-types-parity`(標 SHIPPED v1.0,§1.1 列為 P0)|
| 證據 | `displayMask` 全 repo 僅 `field-type-registry.ts:264,267` 兩行,**`apps/web/src` 命中 0**;`parentField` / `optionParents` / `choices[].parents` 同樣 web 命中 0 |
| 後果 | 遮罩即使打 API 設了**也沒有效果**(`field-input.tsx` 無此分支);連動選項無 UI、無填單過濾、無後端硬驗 |

### 2.5 `layout.statics[]` 在**填單端零 reader**

| | |
|---|---|
| 模組 | `form-designer-2d`(§1.1 目標 2「靜態敘述 / 圖片」)|
| 證據 | 僅設計器畫布讀(`canvas.tsx:103,460`);`header-fields.tsx` 只 map `fields`,`object-page.tsx` 的 sections 是另一組寫死字串 |
| 移交 | §0.5 裁定「移交 `form-designer-wysiwyg`」,而該檔 §1.2 範圍表(①–④)與 §9 里程碑**都沒有接收這一項** → **移交無接收方** |

### 2.6 顯示格式端點**沒有型別閘**

| | |
|---|---|
| 模組 | `date-and-display-format` |
| 證據 | `apps/api/src/form-engine/api/forms.controller.ts:389-406`:只驗欄位屬於該表,**不驗 `field.type`**,直接把 `dateFormat` 併進 `field_def.options` |
| 危害 | `options.dateFormat` 在 **`autoNumber` 是另一個語意**,且其 `optionsSchema` 為 `.strict()` + `z.enum(["yyyy","yyyyMM","yyyyMMdd"])` → 對 autoNumber 欄打這支會寫入該 schema 不接受的值,而 `record.service.ts` 會據此切成 patterned counter |
| 諷刺 | 同一支方法**上方 20 行**才剛補過「綁了租戶不等於有權存取這一筆」的註解 —— 型別閘是同一形狀的下一格 |

---

## 3. 🟡 十一條

| # | 模組 | 內容 |
|---|---|---|
| 1 | `webhook-and-events` | **事件類型只有 API 能設**:UI 建端點恆送 `eventTypes: []`(`settings/integrations/page.tsx:128`),清單無編輯入口;而空陣列在 `event-fanout.service.ts:148` 等於**全訂閱**。使用者無法只訂閱 `record.created` |
| 2 | `webhook-and-events` | **FMEA W5 的測試是假綠**:`events-webhooks.integration.test.ts:122-131` 以未知欄位觸發失敗,但 `validateValues` 在 `insertOne` **開頭**就擲錯,`emitInTx` 根本沒執行 → 「事件不留」與是否同 tx 無關(實作結構上確為同 tx,問題在**測試不構成證據**)|
| 3 | `settings-center` | `purgeExpiredAudit()`(`security.service.ts:186`)**零呼叫者**,排程清單也沒有對應 cron。§4.1 逐字「認證活動紀錄(保留 6 個月)」實際只存在一個常數;稽核列含 IP,無限期堆積 |
| 4 | `form-templates` | OQ-TPL-6=C 裁定的 `template_key` / `template_version` **零落地**(drizzle 0001–0051 無此欄,全 repo 命中 0)。該裁定的理由逐字是「**現在不記以後補不回來**」 |
| 5 | `conditional-format` | §12 FMEA 收尾表**停留在 v1.0**:G2 逐字「✅ 本模組**不提供**條件式隱藏」,而 C-2 已出貨 `hide`。**G2 的 ✅ 建立在「沒做這個功能」之上,而功能已經有了** —— 讀該表會得到錯的安全結論 |
| 6 | `actions-approval` | 同檔自相矛盾:§4.4 已記 ZEN 於 2026-08-03 移除,但 **§7-bis 安全表仍逐字寫「QuickJS 函數節點 sandbox + 50ms timeout」**。**該表宣稱的緩解機制現已不存在** |
| 7 | `approval-advanced` | A1(會簽分母把送簽者算進去,P0)**只由程式碼守著**:e2e `:96-97` 是 `toBe(0)` / `toBeGreaterThanOrEqual(1)` —— **分母 2 或 3 都會綠**;整合測的會簽案例角色成員裡剛好沒有送簽者,而 §12 A1 自己就說那正是當初沒抓到的原因。**修好了,但下次改壞不會紅** |
| 8 | `authz-resource-inheritance` | §6.2 逐字「鎖圖示 + **「申請存取」**」,實際 `app/page.tsx:31` 只有靜態文字「無存取權,請洽管理員授予」。§12.4 有註明延後,但 §6.2 未加刪節線 → 兩節互相矛盾 |
| 9 | `notifications` | (a) `scope: "category"` 後端完整落地、前端鏡射也收,但設定頁**只送 `tenant` 與 `form`** → 分類層只能打 API 設。(b) `notifications.spec.ts:73-80` 的洩漏測試**未先斷言通知項存在** → seed 失敗時恆真(同檔上一條有做,形成對照)|
| 10 | `option-colors` | §2、OQ-OC-5/6、FMEA C1/C3 全部描述已不存在的 `options.colors` side map(#105 已改 `choices[].color`);C3 宣稱的後端 `superRefine` 已退場。**風險本身確已消除,屬敘述漂移非漏洞** |
| 11 | `image-signature-fields` | OQ-IS-8 重裁 A′ 的原建議逐字要求「新增一條 e2e 斷言(設計器與填單頁存在該說明文字)」。文案兩處確實落地,但 `image-signature.spec.ts` **對該文字零斷言** —— 而 A′ 的整個論據就是「緩解必須落在使用者端」 |

---

## 4. ⚪ 過期敘述(事已做完,文件還寫著待辦)

**「待辦不會自己過期」本輪再中四次** —— 這是 memory 裡 `pitfall_stale_todo_already_done` 的第五到八次:

| 模組 | 文件說 | 實際 |
|---|---|---|
| `dynamic-permissions` §12.3 | keyset 分頁非 id 排序會跳列「**應另立小項修為複合 cursor**」 | `keyset.ts` 檔頭逐字寫著已改為遞迴展開述詞,且有 `keyset-pagination.integration.test.ts` |
| `full-text-search` §5 S5 | `statement_timeout`「**未設於此路徑**」 | `search.service.ts:144` 已 `SET LOCAL … 5s` + `57014` 轉 `SearchTimeoutError` |
| `data-export` §12 E8 | 每日 10 次上限被自動化測試消耗,「額度未區分」 | `e2e/global-setup.ts:143` 已歸零當日配額(由 `field-label-a11y` §7-bis 順帶修,**該處有回填、這裡沒有**)|
| `grid-and-excel-import` §0-bis | 多工作表寫死 `SheetNames[0]`、標題列寫死 `matrix[0]` | `excel/parse.ts:25-31` + `panel.tsx:227-246` 皆已修(工作表下拉 + 標題列偵測)|

另:`grid-and-excel-import` 的 OQ-GEI-3=A(前端解析)已被 `import-to-existing-form.md:269` **正式推翻**,
且該行逐字要求「`grid-and-excel-import.md` 需標註」,**本檔至今未標**。

**檔頭狀態過期**|`import-to-existing-form`(仍「APPROVED 進 M1」而 §13 已記 M1–M3 SHIPPED)·
`form-designer-wysiwyg`(仍「M0 APPROVED」而 M1 已出貨 7 檔)· `form-templates`(`MODULES.md:37` 仍「M0 DRAFT」)·
`authz`(仍「APPROVED」而 §9 M5 管理 UI 已 ✅)· `field-types-parity`(檔頭 v1.0,MODULES 已 v1.1)。

---

## 5. 查無問題(11 份)

`form-engine-core` · `form-designer-ui` · `frontend-uplift` · `formula-and-linkload` ·
`grid-paste` · `pivot-and-charts` · `public-form` · `record-workbench-ui` · `recycle-bin` ·
`workspace-ia` · `field-label-a11y`

其中兩份值得單獨記:
- **`field-label-a11y`** 的全稱守衛(`designer.spec.ts:111-129`)**非恆真** —— 找不到「填寫」區塊會回 `["找不到填寫區塊"]` 使斷言失敗。這是本輪唯一一條「負向斷言自己帶了失敗路徑」的寫法。
- **`pivot-and-charts`** 有一條**專釘第一約束**的 e2e(`widgets.spec.ts:66`「不用打 API 就能建小圖表」)。本輪六條 🔴 裡有四條,如果各自有這樣一條測試就不會發生。

---

## 6. 本輪最該記住的一句

> **`pivot-and-charts` 有一條測試叫「不用打 API 就能建小圖表(第一約束)」。
> 六條 🔴 裡有四條,是因為別的模組沒有那條測試。**

第一約束寫在 `AGENTS.md` 的最上面、每個 session 自動載入、每份 design doc 都引用它 ——
**而它在 CI 裡只有一條斷言。**
規則沒有檢查就會漏,這是 memory 裡 `pitfall_rule_without_check_always_drifts` 的第六次。

---

## 7. 稽核本身的限制(誠實聲明)

- **六條 🔴 全部由本人回程式碼複驗**(grep + 讀呼叫鏈);§3 的十一條 🟡 **採信分組稽核的驗證敘述,未逐條重驗**。
- **未跑任何測試**;「假綠」的判定來自讀測試碼的控制流,**未以實驗證明**(例:§3-2 未實際讓 emit 之後失敗來確認)。
- **未評估實作品質**,只評估「宣稱與可達路徑是否一致」。
- 線上 URL 一律未複核;各模組自述的實測數據未重跑。
- **未查**:R2/R3 模組(J–U)、`packages/formula` 與 `packages/rules` 的內部品質、mockup 檔。
