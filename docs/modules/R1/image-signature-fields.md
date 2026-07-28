# image-signature-fields.md — [R1·UP-4b] 圖片欄 + 簽名欄(field-types-parity P1 解鎖)設計文件

> ✅ **狀態:SHIPPED v1.0(2026-07-28;M1–M4 + FMEA S1–S7)**
> **裁定摘要**|1=A 獨立 image 欄型 · 2=A 沿用 `[{key,name}]` · 3=A fetch→blob 預覽 · 4=A P0 不做 Sharp 縮圖 · 5=A canvas→PNG 走上傳管線 · 6=A 自建 Pointer Events 簽名板 · 7=A 最小選項集 · 8=A 只做畫押圖片不宣稱效力。
>
> **這是 field-types-parity 的 P1 子件,阻塞已除。** 該模組 SHIPPED 時記錄:
> > **OQ-FTP-6**|image / signature / attachment 上傳「依賴檔案儲存基礎設施(上傳端點 + 物件儲存抽象 + 大小/數量限制)」→ 排除 P0,自成 P1。
>
> [F-5 file-storage](../foundation/file-storage.md) v1.1 已 SHIPPED(attachment 欄已可上傳/下載/移除),圖片與簽名所需的管線**全部就緒**:magic bytes 白名單已含 `image/png · jpeg · gif · webp`、兩階段綁定、租戶配額、孤兒回收、下載權限鏈。本模組只補**兩個欄型與其輸入 UI**。
>
> 作者:Claude Code(草擬)
> 版本:v0.1(2026-07-28)
> 上游:docs/27 §2 P0 明列「**圖片欄(獨立於附件)**、**簽名(canvas→PNG 附件管線)**」;docs/25 §54/58「缺 簽名/圖片」;docs/23 v6.1 C2「基本簽名欄位 R1、合規電子簽章 TWCA → R2」

---

## 0. 競品證據(clean-room:只讀公開文件與截圖,未接觸任何原始碼)

| 主題 | Ragic | Airtable | Teable / Baserow |
|---|---|---|---|
| 圖片欄 | **獨立「圖片上傳」欄型**,與「檔案上傳」分開;縮圖預覽(預設 120px 高,可設最高高度/最寬寬度)、可勾「上傳多張圖片」、排列方向(垂直/水平)、縮放模式 | ❌ 無獨立型別,統一 Attachment;圖片自動預覽(JPG/PNG/GIF/TIFF/WebP/HEIC) | Attachment 單一型別,支援預覽與批次下載 |
| 簽名欄 | **獨立「簽名」欄型**:滑鼠/觸控手寫;可上傳背景圖或載入預製簽名;「儲存時移除邊界空白區域」;儲存為圖片 | ❌ 未查到 | ❌ 未查到 |
| 簽名 vs 簽核 | **明確分開**:簽名=欄位(手寫圖片);簽核=流程功能(設定簽核 / 簽核公式 / 簽核報表) | — | — |

> 證據檔:`reference-materials/ragic-doc-zh-TW/.../doc/27/欄位種類.html`(圖片欄與簽名欄設定明載)、`.../doc/15/設定簽核.html`(簽核為流程非欄位)、`airtable-support/attachment-field.html`、`teable-docs/.../attachment.md`。強度:Ragic 明載;Airtable/Teable/Baserow「無簽名欄」為**未查到**(非證實不存在)。

**兩個對本模組的直接啟示**
1. **圖片欄獨立成型別是 Ragic 範式的一部分**(客戶心智模型)。Airtable 用統一 attachment 是消費級簡化,且它的 grid 會自動預覽圖片 —— 我們用 Glide 網格,不會自動預覽,少了那層自動性,統一型別就少了說服力。
2. **簽名欄是 Ragic 獨有、競品普遍沒有**,而客戶正是 Ragic 用戶 → 遷移必備(docs/27 §48 亦把「簽名」列為「Ragic 獨有(R1 遷移必備側)」)。

---

## 1. 目標與範圍

### 1.1 目標(P0)

1. **`image` 欄型**|獨立於 attachment;值沿用 `[{key,name}]` 契約;填單可上傳多張、縮圖預覽、移除;記錄頁 / 清單 / 列印顯示縮圖。
2. **`signature` 欄型**|canvas 手寫板 → PNG → 走既有上傳管線;單張;可清除重簽;記錄頁顯示簽名圖。
3. **上傳型別收斂**|`image` / `signature` 欄只接受影像類 MIME(不是「attachment 能接什麼都能接」)。
4. **零 migration**|兩型皆 `jsonb` 欄(同 attachment),新欄型只是 registry 加項 —— 既有表零遷移。

### 1.2 不做的事(scope 邊界)

- ❌ **伺服器端縮圖(Sharp)**|見 OQ-IS-4;P0 以顯示尺寸限制替代,原圖直出。
- ❌ **EXIF 剝除**|需影像處理相依,與縮圖同批 → P1(§12 S4 明列隱私殘留)。
- ❌ **合規電子簽章(TWCA / 不可否認性 / 時戳)**|docs/23 v6.1 C2 已裁定 → **R2**。本模組只做「畫押圖片」,**不宣稱法律效力**(OQ-IS-8)。
- ❌ **Ragic 之簽名背景圖 / 載入預製簽名 / 移除邊界空白**|OQ-IS-7 → P1。
- ❌ **HEIC/TIFF**|magic bytes 白名單未含(iPhone 原生格式需轉檔相依)→ P1,與縮圖同批。
- ❌ **Glide 網格內編輯圖片/簽名**|同 attachment,網格不可 inline 編輯(僅顯示有無)。

---

## 2. 上游 / 既有現況走查

| 子題 | 現況 | Gap |
|---|---|---|
| 上傳管線 | ✅ `POST /api/forms/:formId/files?fieldId=`(magic bytes / 大小 / 配額 / 兩階段綁定) | `ATTACHMENT_FIELD_TYPES` 目前只含 `attachment` → 需納入新兩型 |
| 影像 MIME | ✅ 白名單已含 png / jpeg / gif / webp | image 欄需**再收斂**為只允許影像(目前 attachment 欄可傳 PDF/Office) |
| 下載 | ✅ API 代理 + 權限鏈;**固定 `Content-Disposition: attachment` + `application/octet-stream`**(docs/22 防 XSS) | 預覽不可用 `<img src=端點>`;走 fetch→blob→objectURL(見 OQ-IS-3) |
| 前端附件 UI | ✅ `AttachmentInput`(選檔 / 上傳 / 移除 / 錯誤) | image 需縮圖版;signature 需 canvas 板 |
| 欄型 registry | ✅ 26 型;attachment 為 `jsonb` + `[{key,name}]` | 加 `image` / `signature` 兩型 |
| 簽名板相依 | ❌ 無(`qrcode.react` 為唯一繪圖相依) | 見 OQ-IS-6 |

---

## 3. scope 切分

| 里程碑 | 內容 | 估算 |
|---|---|---|
| **M1 後端** | registry 加 `image` / `signature`(jsonb + `[{key,name}]`)+ 上傳閘門納入兩型 + **影像 MIME 收斂** + 整合測 | 0.04 mo |
| **M2 前端 image** | `ImageInput`(多張上傳 / 縮圖預覽 / 移除)+ 設計器 palette | 0.05 mo |
| **M3 前端 signature** | `SignaturePad`(canvas + pointer events + 清除)→ PNG → 上傳;單張語意 | 0.05 mo |
| **M4 顯示面 + 收尾** | Object Page / 清單 / 列印之縮圖呈現 + `image-signature.spec` + §12 FMEA + doc v1.0 + MODULES | 0.03 mo |

**合計 ≈ 0.17 mo**(field-types-parity 既列人月內之 P1 子件,不新增總量)。前端與後端**分開 commit**。

---

## 4. 設計要點

### 4.1 欄型定義(M1)
```ts
image:     { dbFieldType: "jsonb", valueSchema: [{key,name}] max 20, optionsSchema: { maxHeightPx? } }
signature: { dbFieldType: "jsonb", valueSchema: [{key,name}] max 1,  optionsSchema: { penColor?, heightPx? } }
```
- 與 attachment **同契約**(OQ-IS-2)→ file-storage 之綁定 / 配額 / 孤兒回收 / 下載權限**零改動**即適用。
- `signature` 以 `max 1` 表達「單張」語意(而非另立契約)。

### 4.2 上傳型別收斂(M1;安全)
`FilesService.upload` 目前只驗「欄位是 attachment 型」。改為依欄型決定允許的 MIME 集合:
- `attachment` → 現行完整白名單
- `image` / `signature` → **僅 `image/*`**(png/jpeg/gif/webp)
不符即 415。理由:圖片欄收到 PDF 會在 UI 破圖,且擴大了該欄的攻擊面。

### 4.3 預覽取得方式(M2/M3;技術約束)
下載端點固定 `attachment` disposition + `application/octet-stream`(docs/22 防 HTML/SVG XSS,**不放寬**)。
預覽走既有 `fetch → blob → URL.createObjectURL`(dev 需帶租戶標頭,本就得走 fetch),並於元件卸載時 `revokeObjectURL`。

### 4.4 簽名擷取(M3)
canvas + Pointer Events(滑鼠/觸控/手寫筆統一事件模型)→ `canvas.toBlob("image/png")` → 既有上傳端點。
`devicePixelRatio` 縮放避免高 DPI 模糊;`touch-action: none` 防止畫線時頁面捲動。

---

## 7. 資料模型變動

- **無 migration**:兩型皆 `jsonb`,新欄由使用者日後建立;既有表零遷移。
- **無新端點**:沿用 file-storage 之上傳 / 下載 / 刪除。

---

## 8. 測試策略

| 層級 | 覆蓋 |
|---|---|
| Integration(api)| 建 image/signature 欄 → 上傳影像成功;**上傳 PDF 到 image 欄 → 415**;signature 欄值超過 1 張 → 422;跨租戶下載仍擋 |
| e2e(Playwright)| image:選檔 → 縮圖出現 → 存檔 → 記錄頁顯示;signature:畫線 → 存檔 → 記錄頁顯示簽名圖 → 清除重簽 |

---

## 10. 開放問題(OQ-IS-N)— ✅ 已裁定 2026-07-28(全採建議)

| # | 議題 | 選項 | 建議 = 裁定 |
|---|---|---|---|
| **OQ-IS-1** | 圖片欄是否獨立於 attachment | A. **獨立 `image` 欄型**<br>B. `attachment` + `options.imageOnly` | **A** — Ragic 明載為獨立欄型,客戶心智模型即如此(遷移時欄型要對得上);且 docs/27 §2 已寫「圖片欄(獨立於附件)」。Airtable 用統一 attachment,但它的 grid **自動預覽**圖片;我們用 Glide 網格無此自動性 → 統一型別會失去圖片欄的意義。**證據**:Ragic doc/27 |
| **OQ-IS-2** | 值契約 | A. **沿用 `[{key,name}]`**(同 attachment)<br>B. 新契約含 `width/height/thumbKey` | **A** — file-storage 的綁定 / 配額 / 孤兒回收 / 下載鏈全部吃這個契約,沿用即**零後端改動**;尺寸資訊在做伺服器縮圖(P1)前無來源,先放進契約會是空欄位 |
| **OQ-IS-3** | 預覽如何取圖 | A. **fetch → blob → objectURL**<br>B. 放寬下載端點為 `inline` + 真實 content-type | **A** — B 會破壞 docs/22 明列之「一律 attachment disposition」不變量(該不變量正是防 HTML/SVG XSS);且 dev 下本就需帶租戶標頭故必須走 fetch。A 已於 file-storage M4 前端證實可行 |
| **OQ-IS-4** | 伺服器端縮圖 | A. **P0 不做**,前端以 `max-height` 顯示、原圖直出;Sharp → P1<br>B. P0 即接 Sharp | **A** — Ragic 有縮圖(預設 120px)是為列表密度與頻寬;但 Sharp 是新原生相依 + CPU + 儲存加倍,而 pilot 圖片量小、單檔已有 20MB 上限。**誠實代價**:大圖會拖慢列表 → §12 S3 明列,量測到痛再上 P1 |
| **OQ-IS-5** | 簽名值儲存 | A. **canvas → PNG → 既有上傳管線**(值 `[{key,name}]` 單張)<br>B. base64 data URL 存 text 欄 | **A** — docs/27 §2 已寫「canvas→PNG 附件管線」。B 會讓記錄列變肥(base64 約 +37%)、且**繞過**檔案配額 / 孤兒回收 / 下載權限鏈,等於為簽名另建一套沒有治理的儲存 |
| **OQ-IS-6** | 簽名板實作 | A. **自建 canvas + Pointer Events**(約 80 行,零相依)<br>B. 引入 OSS 簽名套件 | **A** — 需求僅「畫線 / 清除 / 匯出 PNG」;Pointer Events 已統一滑鼠/觸控/手寫筆。少一個相依符合供應鏈鐵則(AGENTS 🔒 7)。若日後要壓感/平滑曲線再評估 B |
| **OQ-IS-7** | 簽名欄選項範圍 | A. **P0 只做 筆色 + 高度 + 清除重簽**;Ragic 之背景圖 / 載入預製簽名 / 移除邊界空白 → P1<br>B. P0 對齊 Ragic 全套 | **A** — 三者中「移除邊界空白」需影像處理(與縮圖同批)、「載入預製簽名」語意上接近「代簽」需先想清楚治理。先上最小可用 |
| **OQ-IS-8** | 簽名的效力宣稱 | A. **明文化為「畫押圖片」,不宣稱不可否認性**;合規簽章維持 R2;簽名欄**可重簽**(受欄位權限 + 稽核)<br>B. 簽完即唯讀,營造「已簽署」不可變感 | **A** — B 會給出沒有密碼學支撐的安全感(**造假**)。真正的不可竄改來自 R2 合規簽章與既有簽核鎖(actions-approval 之記錄鎖)。Ragic 亦將簽名(欄位)與簽核(流程)分離 —— 我們的簽核流程已 SHIPPED,兩者不該混談 |

---

## 12. 失效場景反思(FMEA)— ✅ M4 收尾確認(2026-07-28)

> **結論**|P0(S1/S2)已緩解且有測試斷言;S3/S4 為 OQ-IS-4 之已知取捨(誠實殘留)。

| # | 場景 | 落地緩解 | Sev | 狀態 |
|---|---|---|---|---|
| S1 | 圖片欄被上傳可執行檔 / 偽裝影像 | ✅ magic bytes 判型(全域)+ **`isMimeAllowedForField` 依欄型再收斂為僅 `image/*`**,不符 415。測:PDF→image 欄 415、PDF→attachment 欄仍 201(收斂只針對影像欄)| P0 | ✅ |
| S2 | 簽名圖被當成法律效力憑證 | ✅ UI 全程無「已簽署 / 具法律效力」字樣;簽名可清除重簽;元件註解與本 doc 明載合規簽章屬 R2(docs/23 v6.1 C2)| P0 | ✅ |
| S3 | 大量大圖拖慢列表 / 記錄頁 | 顯示尺寸限制(`maxHeightPx`,預設 96)+ 每欄 20 張 + 單檔 20MB + 租戶配額。**殘留:無伺服器縮圖**(OQ-IS-4=A 之取捨;原圖直出)| P1 | ⚠️ 已知 |
| S4 | 照片 EXIF 含 GPS / 裝置資訊外流 | **殘留**:P0 無剝除能力(需影像處理相依)。**隱私影響須知**:手機拍攝之照片可能含 GPS,下載者可讀取 → 與縮圖同批(Sharp)補 | P1 | ⚠️ 未做 |
| S5 | 簽名 canvas 在觸控裝置畫線時頁面捲動 | ✅ `touch-action: none` + Pointer Events(統一滑鼠/觸控/手寫筆)| P1 | ✅ |
| S6 | 高 DPI 螢幕簽名模糊 | ✅ canvas 依 `devicePixelRatio` 放大再以 CSS 縮回;瀏覽器實測 CSS 278×140 → 位圖 556×280 | P2 | ✅ |
| S7 | 簽名未存檔即離開 → 產生孤兒檔 | ✅ 沿用 file-storage 兩階段綁定(未綁 24h → orphaned、72h 實體回收,F-6 M4 排程)| P2 | ✅ |
| S8 | 未簽名即按「確認簽名」→ 產生空白 PNG 佔配額 | ✅ `dirtyRef` 未曾落筆即拒(「請先簽名」),不呼叫上傳。e2e 斷言 | P2 | ✅ |

---

## 13. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-07-28 | **v1.0** | **SHIPPED** — M1 後端(registry 兩型 + 上傳閘門 + 影像 MIME 收斂;**順帶修既有隱性缺陷**:`toDbValue` 原硬編 `"attachment"` 才序列化 → 改以 `dbFieldType === "jsonb"` 判定,否則新 jsonb 欄型存檔必 PG 22P02)· M2 `ImageInput`(多張 + 縮圖 + 移除)· M3 `SignatureInput`(自建 canvas + Pointer Events)· M4 顯示面 + `image-signature.spec` 3 測 + FMEA。api 317 + web 45 + e2e 31 全綠。commit `a057008`(後端)+ `0247c68`(前端)。**殘留**:S4 EXIF 剝除 / S3 伺服器縮圖(Sharp,同批)/ HEIC·TIFF / Ragic 之簽名背景圖·移除邊界空白 / 合規簽章(R2)| Claude Code |
| 2026-07-28 | v0.1 | 初版 DRAFT — field-types-parity OQ-FTP-6 之 P1 子件,阻塞由 F-5 file-storage v1.1 解除。**§0 競品證據**(clean-room):Ragic 明載圖片欄與簽名欄皆為獨立型別、且明確區分簽名(欄位)與簽核(流程);Airtable/Teable 無簽名欄。P0 = 兩欄型 + 影像 MIME 收斂 + 上傳/預覽 UI + 顯示面;縮圖 / EXIF 剝除 / HEIC / 合規簽章 明確排除並附理由。零 migration、零新端點。OQ-IS-1..8 待裁定 | Claude Code |
