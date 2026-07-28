# print-merge.md — [R1·後續-2] 標籤/QR 產生器 + 列印增強(合併列印為 P1)設計文件

> ✅ **狀態：SHIPPED v1.0(2026-07-27;M1–M5 全綠;api 258 + web 22 e2e 過)**
> **落地**｜M0 `5daffc0` · M1 後端 `4620642`(label_def 0013 + CRUD + layout.print)· M2 `7b3f138`+`3778afb`(showAsQr option + barcode QR 實際渲染)· M3 `58b3539`(標籤設計器 + 標籤列印頁)· M4 `de4d46d`(列印頁首/頁尾 + 換頁)· M5 `674deac`(print-merge.spec)。
> **裁定摘要**｜1=A 合併列印排除歸 P1(待 file-storage) · 2=A 專用 label_def 堆疊模型 · 3=A 瀏覽器列印 · 4=A P0 僅 QR(複用 qrcode.react) · 5=A authz Tier-1 車道 · 6=A layout.print 列範圍 · 7=A 明示硬上限。
>
> docs/27 §6「後續」第二項(承 actions-approval SHIPPED)。落地 §4 P1/P2 之列印軸,對應 docs/25 H 列印。
>
> **核心範圍洞見(證據驅動)**|Ragic 的列印能力是**三件不同的事**,阻塞條件天差地別:
> 1. **標籤產生器** —— **完全 in-app 設定**(選欄 + 每欄樣式 + 標籤尺寸 + A4 預覽 + 平舖/一頁一標籤 + 數量參照欄);條碼取自既有條碼欄,label maker 本身不生條碼。**零檔案上傳依賴**。
> 2. **友善列印 + 下載 PDF** —— 瀏覽器渲染;**紙張/邊界/方向明確委派瀏覽器列印設定**(Ragic 不自建)。列印頁首頁尾/換頁為**設計模式之列範圍選取**。
> 3. **合併列印 / 客製列印報表** —— **上傳 .xlsx/.docx 範本**(後者為 Carbone 引擎 `{d.欄位}`,可出 PDF + 密碼)。
>
> 現況盤點對照:**`qrcode.react` 已安裝**(MFA TOTP 已用)、`form_def.layout` metadata 可承載列印設定、print CSS + `window.print()` 已有(form-designer-2d);但**無上傳端點 / 無物件儲存**(與 OQ-FTP-6 同一 file-storage 阻塞)、無 PDF/docx 套件。
>
> → 故 **P0 = 第 1 + 2 件(標籤/QR + 列印增強),零新 infra、零阻塞;第 3 件(範本上傳合併)歸 P1,待 file-storage**(OQ-PM-1)。
>
> 作者：Claude Code(草擬)
> 版本：v0.1(2026-07-25)
> 證據：docs/27 §4 P1/P2(標籤 QR「pilot 客戶實用中 — 進貨憑單 QRcode」、客製列印報表、合併列印;OQ-UP-4 裁定「暫留 P2,遷移盤點複核依賴即升 P1」)、本地 Ragic 參照庫(`doc/40` 標籤 maker、`doc/149` 列印頁首頁尾換頁、`doc/4` 匯出列印上限、`doc/42` 合併列印、`doc/138` 客製列印報表 Carbone、`doc/53` 以條碼顯示、`doc/27` 條碼欄型)、現況盤點(qrcode.react 已裝 / print CSS 已有 / barcode 欄型已有但未渲染 / 無 file-storage)

---

## 1. 目標與範圍

### 1.1 目標(P0)

1. **條碼欄實際渲染**|補 field-types-parity 之顯示層殘留:`barcode` 欄型於填單/記錄頁渲染 QR(複用**已安裝**之 `qrcode.react`);text 欄另加「以條碼顯示」設定(Ragic doc/53 語意,QR-only)。
2. **標籤/QR 產生器**|表單可掛**標籤定義**(in-app 設定,零上傳):選欄 + 順序 + 每欄樣式(字體/大小/對齊/是否顯示欄名)+ 標籤尺寸(寬高 mm)+ **平舖多標籤/頁 或 一頁一標籤** + **數量參照欄**(數值欄決定每筆印幾張)。
3. **標籤列印頁**|A4 平舖預覽 + `@page` 列印樣式 → 瀏覽器列印/另存 PDF;支援**批次**(集合視圖勾選 / 當前檢視結果)。
4. **列印增強(友善列印)**|`form_def.layout` 加列印設定:**列印頁首/頁尾列範圍** + **換頁點**;記錄頁列印沿用既有 print CSS。
5. **誠實上限**|批次列印筆數上限 + 超量明示(對齊 Ragic 式硬上限,不靜默截斷)。

### 1.2 對應訴求

| 子題 | 訴求 | 對應 |
|---|---|---|
| 標籤/QR | pilot 客戶(鮮勇)**進貨憑單 QRcode 實用中** —— 遷移必備依賴 | docs/27 §4 P2 + OQ-UP-4(依賴確認即升 P1);docs/25 H 列印 |
| 列印增強 | 單據友善列印之頁首頁尾/換頁(Ragic doc/149) | docs/27 §4 P2 |

### 1.3 不做的事

- ⏳ **合併列印 / 客製列印報表(範本上傳 + Carbone)**|~~依 file-storage 基礎設施~~ → **【2026-07-27 阻塞已解除】**[F-5 file-storage](../foundation/file-storage.md) SHIPPED v1.0 提供上傳/下載/物件儲存抽象;本件維持 **P1**,待排期時直接接既有 `POST /api/forms/:formId/files` 與 `StorageDriver`(OQ-PM-1)。
- ❌ **伺服器端 PDF 產生**(puppeteer / pdfmake)|P0 走瀏覽器列印(Ragic 亦將紙張/邊界/方向委派瀏覽器);伺服器端 PDF(密碼保護 / 大量非同步)→ P1(OQ-PM-3)。
- ❌ **Code128 等 QR 以外 symbology**|`qrcode.react` 已在且 Ragic 僅列 Code128/QR;Code128 需新依賴 → P1(OQ-PM-4)。
- ❌ **列印輸出寫回記錄之附件欄**(Ragic 批次合併列印可寫回)|依 file-storage → P1。
- ❌ **浮水印 / PDF 密碼 / 公司 logo 上傳**|依 file-storage 或伺服器端 PDF → P1。
- ❌ **Avery 等標籤紙預設版型庫**|Ragic 亦無;使用者自填尺寸 → 未來加值。
- ❌ **報表級自訂頁首頁尾 / 分群報表分頁**|屬報表模組(§4 P2 之外)。

---

## 2. 上游 / 既有現況走查

| 子題 | 現況 | Gap |
|---|---|---|
| QR 渲染庫 | ✅ **`qrcode.react` 已安裝**(`apps/web`;MFA TOTP `QRCodeSVG` 已用)| 直接複用,**零新依賴** |
| `barcode` 欄型 | ✅ 後端型別 + options `{symbology: qr\|code128}`(field-types-parity)| 前端仍為純文字輸入 → **補渲染**(已知殘留) |
| 友善列印 | ✅ `globals.css` `@media print`(隱 nav/footer/`[data-noprint]`)+ `window.print()`(Object Page)| 無頁首頁尾/換頁;無標籤頁 |
| 版面 metadata | ✅ `form_def.layout` JSONB(grid/fields/statics/sections)| 加 `print` 區(頁首/頁尾列範圍 + 換頁)|
| 集合視圖批次 | ✅ 勾選 + 批次刪除 + client 匯出(views-list)| 加「列印標籤」批次入口 |
| 記錄取數 + 顯示格式化 | ✅ `RecordService.getRecord/listRecords`(含 computed/formula/maskRead)+ 前端 `formatFieldValue` | 直接複用 |
| **檔案上傳 / 物件儲存** | ❌ **無**(無 multipart / 無 S3·MinIO;attachment 亦卡)| **阻塞**範本上傳 → P1 |
| PDF / docx 套件 | ❌ 無 | P0 不需(瀏覽器列印);P1 再評估 |

---

## 3. scope 切分

| 里程碑 | 內容 | 估算 |
|---|---|---|
| **M1 後端** | `label_def`(migration 0013;authz Tier-1 車道,同 view_def)+ CRUD API(design 權)+ `form_def.layout` 加 `print{headerRows,footerRows,pageBreaks}` + integration 測(跨租戶/欄位驗證)| 0.08 mo |
| **M2 前端(條碼渲染)** | `barcode` 欄填單/記錄頁渲染 QR(qrcode.react)+ text 欄「以條碼顯示」設定 + 設計器設定 | 0.05 mo |
| **M3 前端(標籤產生器)** | 標籤定義設計器(選欄/樣式/尺寸/平舖/數量參照欄)+ 標籤列印頁(A4 平舖預覽 + `@page` + 批次來源:勾選/當前檢視 + 上限誠實訊息)| 0.12 mo |
| **M4 前端(列印增強)** | 設計器設定列印頁首/頁尾列範圍 + 換頁點;記錄頁列印套用 | 0.06 mo |
| **M5 固化 + FMEA** | Playwright(標籤設定→預覽→列印樣式斷言;條碼渲染)+ §12;doc v1.0 + MODULES ✅ | 0.03 mo |

**合計 ≈ 0.34 mo**(對應 docs/25 H 列印之 P0 首期;合併列印/伺服器端 PDF P1 另計)。M1 後端 / M2–M5 前端**分開 commit**。

---

## 4. 設計要點

### 4.1 `label_def` 資料模型(M1;OQ-PM-2=A 專用 metadata)

```
label_def(id, tenant_id, form_id, name,
  config JSONB {
    size: { widthMm, heightMm },
    tile: boolean,              // true=A4 平舖多標籤 / false=一頁一標籤
    gapMm?: number,
    showFieldNames?: boolean,
    copiesField?: string,       // 數量參照欄(數值欄名;每筆印幾張)
    items: [ { field: string, style?: { size?, align?, bold?, wrap? }, asQr?: boolean } ]
  },
  position, created_at, deleted_at)
```
- **items 為欄位堆疊序**(非 2D 座標)—— 直配 Ragic 標籤語意(選欄 + 順序 + 每欄樣式),與 `form_def.layout` 2D 畫布**刻意解耦**(標籤不是表單版面)。
- `asQr` 或欄型為 `barcode` → 該項渲染 QR。子表欄不入標籤(Ragic 同)。

### 4.2 條碼渲染(M2;OQ-PM-4=A 複用 qrcode.react)
- `barcode` 欄:填單為文字輸入(存值)+ 下方即時 QR 預覽;記錄頁/標籤渲染 QR(`QRCodeSVG`,SVG 對列印友善)。
- text 欄 options 加 `showAsQr?: boolean`(Ragic「以條碼顯示」QR-only 語意,doc/53)。
- `symbology: "code128"` → P0 顯示「Code128 需 P1」提示,不靜默失敗(誠實)。

### 4.3 標籤列印頁(M3)
- 路由 `/app/forms/:formId/labels/:labelId/print?ids=…`(或當前檢視 query)。
- 版面:`@page { size: A4; margin: … }` + CSS grid 依 `size.widthMm/heightMm` 平舖;`tile:false` → 每標籤 `break-after: page`。
- 資料源:勾選 ids 或當前檢視結果(承 views-list query);`copiesField` 展開份數。
- **上限**(OQ-PM-7):預設 ≤ 1000 標籤/次,超過提示「請縮小篩選或分批」(不靜默截斷)。

### 4.4 列印頁首頁尾 + 換頁(M4)
- `form_def.layout.print = { headerRows: [0..n], footerRows: [...], pageBreakAfterRows: [...] }`(列範圍,承 Ragic doc/149 之列選取語意)。
- 記錄頁列印:header/footer 列以 `position: fixed` + `@media print` 重複;pageBreak 列後 `break-after: page`。
- 紙張/邊界/方向:**不自建**,委派瀏覽器列印對話框(Ragic 同)。

---

## 7. 資料模型變動

### 7.2 SQL Migration
- **`0013_label_def.sql`**:`label_def`(tenant_id/form_id/name/config JSONB/position/deleted_at)+ 索引;authz Tier-1 車道(非 RLS,app 層 tenant scope,同 view_def,OQ-PM-5)。
- `form_def.layout` 之 `print` 區為 **JSONB 加法**(既有 layoutSchema 擴充,零 migration)。

### 7.3 RLS / Permission
- `label_def` CRUD = `design` 權;列印/預覽 = `view` 權(+ 記錄本身 `maskRead` 硬底不變 —— 標籤只呈現已授權欄值)。
- 跨租戶由 app 層 tenant scope + form 級 PermissionGuard。

---

## 7-bis. 安全(擇要;完整見 [[rule_security_standards]] + docs/22)

| 面 | 緩解 |
|---|---|
| 標籤洩漏無權欄值 | 資料源走 RecordService(`maskRead` 已剝 hidden 欄);label_def.items 引用欄名於渲染時 ∩ 實際回傳值(缺即略) |
| 跨租戶 label_def | app 層 `where tenant_id` + form 級權限;integration 斷言 B 讀不到 A |
| QR 內容注入 | QR 僅編碼欄值字串(資料,非可執行);SVG 由 `qrcode.react` 產生,不插入 raw HTML |
| 大量列印 DoS / 瀏覽器 OOM | 標籤數硬上限 + 誠實訊息;資料取數走既有分頁/上限 |
| 範本上傳面(未來 P1)| **P0 不開上傳** → 無 .docx/.xlsx 解析面(Carbone/docxtemplater 之 CVE 面亦不引入);待 file-storage 模組統一處理掃描/型別白名單 |

Input validation:label config 全 Zod(欄名長度、尺寸 mm 範圍、items 數上限、copiesField 需為數值欄)。

---

## 8. 測試策略

| 層級 | 覆蓋 | 位置 |
|---|---|---|
| Integration(api)| label_def CRUD 跨租戶隔離;config 驗證(未知欄/尺寸越界拒);layout.print 加法不破既有 | Testcontainers |
| e2e(Playwright)| 建標籤定義 → 標籤列印頁渲染(標籤數 = 筆數 × copies)→ QR SVG 存在 → 一頁一標籤 vs 平舖切換;barcode 欄記錄頁 QR 渲染 | `print-merge.spec.ts` |
| Unit | 份數展開 / 平舖版面計算 / print 列範圍解析 | `*.test.ts` |

---

## 9. 落地順序與里程碑

| 里程碑 | 內容 | 狀態 |
|---|---|---|
| **M0** | 本檔 → APPROVED(OQ-PM-1..7 裁定,全採建議)| ✅ |
| **M1** | 後端:label_def(0013)+ CRUD + layout.print(`4620642`)| ✅ |
| **M2** | barcode 欄 QR 渲染 + 以條碼顯示(`7b3f138`+`3778afb`)| ✅ |
| **M3** | 前端:標籤定義設計器 + 標籤列印頁(批次)(`58b3539`)| ✅ |
| **M4** | 前端:列印頁首頁尾 + 換頁(`de4d46d`)| ✅ |
| **M5** | print-merge.spec 固化 + FMEA + doc v1.0 + MODULES ✅(`674deac`)| ✅ |

---

## 10. 開放問題(OQ-PM-N)— ✅ 已裁定 2026-07-25(全採建議 = 全 A)

> 全數採「建議」欄。進入 M1。

| # | 議題 | 選項 | 建議 = 裁定 |
|---|---|---|---|
| **OQ-PM-1** | 合併列印(範本上傳)是否入 P0 | A. **排除,歸 P1(待 file-storage)**;P0 = 標籤/QR + 列印增強(in-app 設定,零上傳)<br>B. 本模組順帶建最小上傳 | **A** — 範本上傳需 file-storage(上傳端點/物件儲存/型別白名單/掃描),與 OQ-FTP-6 之 image·signature·attachment **同一阻塞**,應由 file-storage 模組統一解;強塞入本模組會重複造輪且擴大攻擊面(.docx/.xlsx 解析)。**證據**:Ragic 合併列印/客製報表皆為**上傳**範本(doc/42、doc/138),而**標籤 maker 為 in-app 設定**(doc/40)→ 天然可切 |
| **OQ-PM-2** | 標籤版面模型 | A. **專用 `label_def`**(欄位堆疊序 + 每欄樣式 + 標籤尺寸 + 平舖設定)<br>B. 復用 `form_def.layout` 2D 畫布 | **A** — Ragic 標籤即「選欄 + 順序 + 每欄字體/對齊/寬高」之堆疊模型,非 2D 座標;與表單版面解耦(標籤≠填單畫面),避免 layout schema 被兩種語意污染。**證據**:doc/40 標籤設定項 |
| **OQ-PM-3** | PDF 產出方式 | A. **瀏覽器列印/另存 PDF**(`@page` CSS;零依賴、零 infra)<br>B. 伺服器端 PDF(puppeteer/pdfmake)| **A** — Ragic 明確將**紙張/邊界/方向委派瀏覽器列印設定**(doc/149),自身只管內容版面;伺服器端 PDF 之價值(密碼保護、大量非同步、寫回附件)**全部依賴 file-storage 或屬 P1**。**證據**:doc/149 + 現況無 PDF 套件 |
| **OQ-PM-4** | 條碼 symbology 範圍 | A. **P0 僅 QR**(複用已裝 `qrcode.react`);Code128 → P1(需新依賴)<br>B. P0 即裝 bwip-js 全譜 | **A** — `qrcode.react` **已在**(MFA 用)→ 零新依賴;pilot 需求為**進貨憑單 QRcode**(docs/27 §4 註記)。Ragic 亦僅列 Code128/QR,且其「以條碼顯示」欄位設定**本身即 QR-only**(doc/53)。Code128 明示為 P1、不靜默失敗 |
| **OQ-PM-5** | `label_def` 車道 | A. **authz Tier-1 DRIZZLE 車道 + app tenant scope**(同 view_def/button_def)<br>B. RLS 車道 | **A** — 標籤定義是 metadata(非 tenant 記錄資料),一致既定模式(view_def/button_def/approval_def 皆此)|
| **OQ-PM-6** | 列印頁首頁尾模型 | A. **`form_def.layout.print` 之列範圍**(headerRows/footerRows/pageBreakAfterRows;設計器選列)<br>B. 獨立範本 | **A** — 直配 Ragic doc/149「設計模式選頂/底列 → 設為列印頁首/頁尾」語意;layout 加法零 migration。**證據**:doc/149 |
| **OQ-PM-7** | 批次上限策略 | A. **明示硬上限 + 超量提示**(標籤 ≤1000 張/次;友善列印沿用既有分頁上限)<br>B. 不設上限 | **A** — 對齊 Ragic 明示上限文化(友善列印 5000 筆 / PDF 單檔 100 筆 / 匯出 >5000 轉 CSV);不靜默截斷(承 views-list 匯出之誠實訊息慣例)。**證據**:doc/4 |

---

## 12. 失效場景反思(FMEA)— M5 收尾(R17);✅=已驗證緩解

| # | 場景 | 緩解 | Sev | 狀態 |
|---|---|---|---|---|
| P1 | 標籤/列印洩漏無權欄值 | 資料源走 RecordService(`maskRead` 後端已剝 hidden 欄);渲染時 `fieldByName` ∩ items,欄位不存在即略過 | P0 | ✅ by design(標籤只呈現已授權回傳值) |
| P2 | 跨租戶讀 label_def / 列印他租戶記錄 | app 層 `where tenant_id` + form 級 PermissionGuard(list=view / CRUD=design) | P0 | ✅ labels.integration 跨租戶斷言 |
| P3 | QR 內容為惡意字串 → 掃碼導向釣魚 | QR 僅編碼欄值(資料,非可執行);`qrcode.react` 產 SVG 不插 raw HTML;不由 QR 觸發動作(動作條碼屬 R2) | P1 | ✅ |
| P4 | 大量標籤 → 瀏覽器 OOM / 列印卡死 | 硬上限 `MAX_LABELS_PER_RUN`=1000 + 超量橫幅明示總數與建議(不靜默截斷)| P1 | ✅ 實作 |
| P5 | 標籤引用已刪欄位 → 破版 | 渲染時 `fieldByName.get` 查無即 `return null`(略過該項,不破版)| P1 | ✅ 實作。⚠️ 殘留:設計器未標示失效項(P1)|
| P6 | `copiesField` 值異常(負數/超大/非數值)| 後端驗須為數值型欄;前端 `copiesOf` 夾限 0..`MAX_COPIES_PER_RECORD`(99)、非數值回 1;總量仍受硬上限 | P1 | ✅ 實作 + labels.integration 非數值欄拒 |
| P7 | print CSS 衝突 / 頁首頁尾重疊 | 標籤頁工具列標 `data-noprint`;頁首/頁尾列採 `break-inside: avoid`、換頁列採 `break-after: page`(不用 fixed → 無重疊風險)| P1 | ✅。⚠️ 殘留:頁首頁尾**未於每頁重複**(僅避免跨頁斷裂);真正重複需 `@page` margin box 或伺服器端 PDF → P1 |
| P8 | layout.print 加法破既有表單 | `print` 為 optional 加法;不帶 print 之舊 payload 仍可存 | P1 | ✅ labels.integration「加法不破既有」測 |
| P9 | 部署順序:前端先於 0013 migration | migration 必先(R10;dev 已 migrate);缺表 → useLabels 空 → 標籤區不渲染(優雅降級)| P1 | ✅ |
| P10 | symbology=code128 之欄位 | `BarcodeView` 明示「Code128 待後續版本」並顯示原值,不靜默空白 | P2 | ✅ 實作 |

> **檢查點**:P0(P1–P2)全 ✅ → SHIPPED。⚠️ 殘留:P7 頁首頁尾未每頁重複(需 `@page` margin box 或伺服器端 PDF)、P5 設計器未標失效欄項;**合併列印/客製報表(範本上傳 + Carbone)、伺服器端 PDF(密碼/浮水印/非同步)、列印輸出寫回附件欄、Code128** 皆 P1(多數待 file-storage)。
>
> **測試環境註記**|全套 e2e 曾出現一次 `permissions.spec` flaky(單獨跑與兩兩組合皆過,重跑全套 22/22 綠)—— 係共用 dev DB 隨每次 e2e 累積表單/分類所致之既有測試脆弱性,非本模組回歸;治本為 e2e 隔離種子(P1)。

---

---

## 0-bis. 追溯稽核(2026-07-29)— **本檔證據充足,僅補標註**

2026-07-28 全庫稽核以「有無 `## 0` 證據段」為判準,本檔被列入「疑似無證據」名單。
**複查後確認為誤判**:證據已散在正文中,只是未集中成 §0 段。

**實際引用的 Ragic 官方文件**|`doc/40`(標籤產生器:選欄 + 樣式 + 標籤尺寸 + 平舖 / 一頁一標籤 + 數量參照欄)·
`doc/149`(友善列印:紙張 / 邊界 / 方向**委派瀏覽器**)· `doc/42`、`doc/138`(合併列印需上傳 .xlsx / .docx 範本)·
`doc/4`、`doc/27`、`doc/53`。全文提及 Ragic 22 處。

**判斷**|**不需重做研究**。本檔的範圍切分(① 標籤 maker 完全 in-app、② 紙張設定委派瀏覽器、
③ 範本上傳才需伺服器)正是直接從上述官方文件推導,屬證據錨定之設計。
既有殘留(頁首頁尾未每頁重複 / 伺服器端 PDF 密碼與浮水印 / Code128)已列於正文,不重複。

> **方法上的教訓**|「有無 §0 段」是**近似指標不是判準** —— 會有偽陽性(本檔)。
> 後續補研究前應先複查正文,避免重做已做過的功課。

## 13. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-07-27 | v1.0 | **M1–M5 SHIPPED**。M1 label_def(0013,authz Tier-1)+ CRUD(欄名/數量欄驗證)+ layout.print 加法。M2 barcode 欄實際渲染 QR(複用 qrcode.react)+ text 欄 showAsQr。M3 標籤設計器(選欄堆疊/尺寸/平舖/份數參照欄)+ 標籤列印頁(@page A4 + mm 平舖 + 份數展開 + 1000 張硬上限明示)。M4 列印頁首/頁尾/換頁(列範圍)+ Object Page 套用。M5 print-merge.spec。FMEA P1–P2 P0 全 ✅;殘留明列。api 258 + web 22 e2e 綠 | Claude Code |
| 2026-07-25 | v0.2 | **OQ-PM-1..7 全裁定(全採建議=全 A);DRAFT → APPROVED,進 M1**。定調:合併列印(範本上傳)排除歸 P1 待 file-storage;標籤走專用 label_def 堆疊模型;PDF 走瀏覽器列印;P0 僅 QR 複用 qrcode.react;label_def 走 authz Tier-1 車道;列印頁首頁尾走 layout.print 列範圍;批次明示硬上限 | Claude Code |
| 2026-07-25 | v0.1 | 初版 DRAFT — docs/27 §6 後續-2。**範圍洞見**:Ragic 列印為三件事,標籤 maker 為 in-app 設定(零上傳)、友善列印委派瀏覽器紙張設定、僅合併列印/客製報表需上傳範本(Carbone)→ P0 取前二(零 infra、零阻塞),範本上傳合併歸 P1 待 file-storage(同 OQ-FTP-6)。`qrcode.react` 已裝可直接複用。OQ-PM-1..7 待裁定 | Claude Code |
