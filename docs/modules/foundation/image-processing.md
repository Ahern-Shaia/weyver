# image-processing.md — [F-7] 影像處理(EXIF 剝除 / 縮圖 / HEIC)設計文件

> ✅ **狀態:SHIPPED v1.0(2026-07-28)** — M1–M4 完成。EXIF 無損剝除 / 320px webp 縮圖 / 50MP 炸彈防護 / 前端 HEIC 路徑皆已上線,api 9 單元 + 4 整合 + web 3 e2e 綠。
> **已知殘留**|(a) 既有影像未回溯剝除 EXIF(OQ-IP-6=A);(b) PNG/WebP 之 metadata 未剝(僅 JPEG 有無損切段實作);(c) **iOS Safari 自動轉檔前提未實機驗證**(桌面 harness 無法測,見 FMEA P9)。
> **裁定摘要**|1=A 前端轉檔 · 2=A 同步縮圖 · 3=A 衍生 key · **4=C 無損切段優先** · 5=A 50MP 上限 · 6=A 不回溯 · 7=A 單一 320px webp 永不放大 · 8=B WASM 留 P1(**M3 須實測 iOS 自動轉檔前提**)· 9=A 不建重生工具,缺縮圖退回原圖。
>
> **收斂三個模組共同記錄的 P1 殘留**(皆註明「需影像處理相依,同批補」):
> - `image-signature-fields` §12 **S4**|照片 EXIF 含 GPS / 裝置資訊外流 —— P0 無剝除能力
> - `image-signature-fields` §12 **S3**|無伺服器縮圖,原圖直出拖慢列表
> - `image-signature-fields` §1.2|**HEIC/TIFF 不支援**(iPhone 原生格式)
> - `file-storage` P1|縮圖 Sharp
>
> 作者:Claude Code(草擬)
> 版本:v0.2(2026-07-28;競品研究後改寫 OQ-IP-4、OQ-IP-7,新增 OQ-IP-9)

---

## 0. 證據(**本節有兩項實測推翻了原本的規劃前提,請先讀**)

### 0.1 本機實測(對**我們實際安裝的** sharp 0.34.5 / libvips 8.17.3)

| 測項 | 結果 | 意義 |
|---|---|---|
| HEIC **像素解碼** | ❌ `heif: Error while loading plugin` | **HEVC 解碼器不在**;HEIC 讀不了 |
| HEIC 容器 metadata | ✅ 讀得到(heif · 16320×9180 · 有 EXIF)| 只證明容器可解析,不代表能取像素 |
| HEVC 編碼 | ❌ `heifsave: Unsupported compression` | — |
| AVIF(AV1)| ✅ 編解碼皆可 | 預建版帶 libheif 但**只有 AV1 沒有 HEVC** |
| 現行上傳白名單對 HEIC | `detectType` → `null` → **415 拒絕** | iPhone 直傳照片現在會被擋 |
| 真實照片之 EXIF(IFD0 解析)| 含 **GPS IFD 指標 / Make / Model / DateTime**(916 bytes)| **隱私風險已證實,非假想**(僅驗存在,未取座標值)|
| sharp 輸出是否帶 EXIF | ❌ 預設不帶 | 剝除是**預設行為**,不需額外處理 |
| **1.6 MB 檔案宣告 149.8 MP** | sharp 預設 [`limitInputPixels`](https://sharp.pixelplumbing.com/api-constructor/) = **268402689**(約 268 MP)→ **擋不住** | 解成 raw RGB ≈ **450 MB**;20 MB 上傳上限**完全不約束解碼期記憶體** |
| 顯式 `limitInputPixels: 12M` | ✅ `Input image exceeds pixel limit` | 緩解有效 |
| 24 MP → 240px 縮圖 | **28 ms** | **同步處理可行,不需背景 job / 佇列** |

### 0.2 網路研究(sharp 官方文件 / 維護者聲明 / 專利池條款)

1. **sharp 預建二進位不會含 HEIC** —— 維護者(repo owner `lovell`)2025-11-25 於 [issue #4479](https://github.com/lovell/sharp/issues/4479) 逐字:
   > providing source code is a different legal matter to providing binaries that can process data using patent-encumbered technology.
   > I've been advised that the current download counts of sharp might incur licensing fees of around **US$25m/year**.
   > sharp will always support use of a **globally-installed libvips** that itself has been compiled with support for HEIC images.

   ⚠️ **措辭更正(2026-08-06 覆查)**:原文寫「這是**永久政策**」—— 維護者並未逐字這樣說。
   他說的是上述理由,以及「永遠支援自編的 libvips」。**合理推讀不等於原文**,故改為引述原句。
2. **授權不是問題,專利才是**([Access Advance: What Do We License](https://accessadvance.com/topic-what-do-we-license/) 逐字:「**Royalties are due annually (or as otherwise agreed) per authorized user** for HEVC Decoders and/or Encoders **used to provide or made available for use through Cloud-Based Services**」)|libheif / libde265 為 **LGPL**(自由軟體;SaaS 不散布二進位故 copyleft 不觸發,亦非 AGPL);x265 為 GPL 但那是**編碼器**,只做解碼可完全不編入。**但** Access Advance(HEVC 專利池)條款**明文將雲端服務納入**,decoder「used to provide or made available for use through Cloud-Based Services」按 authorized user 逐年計費 —— Weyver 是商用多租戶 SaaS,落在其收費範圍。
3. **iOS Safari 會自動轉檔**|`<input type="file">` 之 `accept` **不含** `image/heic` 時,系統自動把 HEIC 轉成 JPEG 才送出(社群普遍回報,非 Apple 官方文件 → 證據強度中)。
4. **`ignore-scripts` 不是障礙 —— 但 2026-08-06 覆查發現原本寫的理由是錯的。**

   原文:「sharp **≥ 0.33** 改用 optionalDependencies + cpu/os/libc 篩選,**已無 install script**」。
   🔴 **斷點不是 0.33,是 0.35.0。** 本專案開檔實測(`node_modules/.pnpm/`):

   | 版本 | `scripts.install` |
   |---|---|
   | 0.34.5(本專案實裝)| `node install/check.js \|\| npm run build` ← **有** |
   | 0.35.3(本專案亦有)| 無 |

   對的那一半:0.33.0 確實改走 optionalDependencies + 平台篩選
   ([changelog v0.33.0](https://sharp.pixelplumbing.com/changelog/v0.33.0/):
   「Prebuilt binaries distributed via npm registry and installed via package manager.」;
   [安裝說明](https://sharp.pixelplumbing.com/install/) 有 `--os` / `--cpu` / `--libc` 章節)。

   **結論仍然成立,理由要換**:`--ignore-scripts` 沒問題不是因為「沒有 install script」,
   而是因為**預建二進位由 optionalDependencies 提供**,install script 只是 fallback
   (`|| npm run build`)。CI(`ci.yml` 用 `--ignore-scripts`)實跑綠可佐證。
   ⚠️ **對的結論配錯的理由**,會誤導日後除錯的人 —— 這正是要附出處的原因。
5. **容器坑**|glibc 與 musl 是不同套件;跨平台安裝需 `supportedArchitectures`;glibc 記憶體碎片化建議設 `MALLOC_ARENA_MAX`(Cloud Run 有記憶體上限)。

### 0.3 競品實作(clean-room:只讀公開文件與截圖檔名)

| 面向 | Ragic | Airtable | Teable | Baserow |
|---|---|---|---|---|
| 縮圖檔數 | **1(可調)** | 3(small / large / full)| 2(`smThumbnailUrl` / `lgThumbnailUrl`)| 2+ |
| 縮圖尺寸 | **預設高 120px、寬等比;可設上限;永不放大**([Ragic `doc-kb/148`](https://www.ragic.com/intl/zh-TW/doc-kb/148/) 逐字:「系統預設的縮圖尺寸為**高度 120 px**,並依照原圖比例自動調整寬度」「縮圖的尺寸都**不會超過原圖大小**(不會放大圖片)」)| **官方未載像素**(社群說 72 / 1024 / 3000,數值分歧不宜當規格)| 未載 | 未載 |
| 是否改原檔 | 未查到 | **官方明載**([attachment field](https://support.airtable.com/docs/attachment-field)):「Airtable **does not modify the underlying file**, which can be retrieved through the download button.」| 未查到 | 未查到 |
| 縮圖定址 | — | metadata 記錄衍生 URL(**2 小時過期**)| metadata 記錄衍生 URL | — |
| HEIC | 未查到 | 官方明載可預覽(機制未說明)| 未查到 | — |

**其他業界證據**
- **Teable changelog 是「方向坑」的直接實證**([changelog](https://help.teable.ai/en/changelog),2026-07-14):
  「Fixed mobile photo thumbnail orientation: New or **regenerated** thumbnails now respect EXIF orientation **in Gallery and Grid views**.」
  —— 競品實際踩過 iPhone 照片轉向錯誤。
- **Teable 同時證明「預生成派」的代價**:「**regenerated** thumbnails」。
  🔴 **2026-08-06 覆查更正**:原文引「Improved recovery for missing thumbnails on older **attachments**」——
  官方原句是「on older **PDF** attachments」(2026-04-27),**漏掉 PDF 一字把 PDF 專屬的修補寫成泛指所有附件**,
  範圍被放大。同段另有「Older PDFs now show cover thumbnails more consistently」佐證其為 PDF 專屬。
- **Dropbox 提供客戶端「以 JPG 上傳」設定**([iOS 檔案格式](https://help.dropbox.com/create-upload/ios-formats):「you can set your HEIF and HEVC files to **upload as JPG**」;設定路徑 Camera Uploads → 「Save HEIC Photos as」)—— 大廠採**上傳端轉檔**之先例,支持 OQ-IP-1=A。
- **EXIF 業界分歧**:FB/IG/X 剝 GPS;**Slack 原樣保留**;B2B 工具偏向保留原檔。
- **事故先例(強證據)**:活動 SaaS **Partiful** 遭 [TechCrunch 揭露](https://techcrunch.com/2025/10/04/event-startup-partiful-wasnt-stripping-gps-locations-from-user-uploaded-photos/)(2025-10-04)未剝除使用者照片的 GPS。逐字:
  > TechCrunch found that the app was **not stripping the location data** of user-uploaded images, including public profile photos.
  > TechCrunch found by Saturday that **metadata was removed from existing user-uploaded photos**.

  ⚠️ **措辭更正**:原文寫「**兩日內**修補」—— 那不是原文。Partiful 起初回覆「next week」,
  經 TechCrunch 催促後於當週六修補並回溯清洗。回溯清洗這件事確認無誤。對 Weyver 之現場品檢照 / 工單照,這是可預見的 PDPA 風險。
- **格式**:2026 縮圖預設 **WebP**。同畫質較 JPEG 小 **25–34%**
  ([Google 官方](https://developers.google.com/speed/webp):「WebP lossy images are **25-34% smaller** than comparable JPEG images at equivalent SSIM quality index.」)。
  🔴 **支援度更正**:原文寫「>97%」,[caniuse](https://caniuse.com/webp) **2026-08-06 實測為 96.07% + 0.08% ≈ 96%**
  (以原始資料集 `features-json/webp.json` 覆核)。**這個數字會隨瀏覽器統計浮動,本來就必須綁查證日期。**

### 0.4 本機再測(重新編碼 vs 無損剝除;2400×1600 照片級圖)

| 作法 | 大小 | 品質 |
|---|---|---|
| 原始 JPEG q92 | 990 KB | — |
| 重編碼 q95 | 1130 KB(**+14%**)| 仍失真,檔案反而變大 |
| 重編碼 q90 | 912 KB(−8%)| 失真 |
| 重編碼 q85 | 762 KB(−23%)| 失真較明顯 |
| **無損切除 APP1/APP13 段** | −0.3 KB | **零失真**(已驗證壓縮資料位元組相同)|
| 縮圖 320px webp | 1.7 KB / 17 ms | — |

> **重編碼是世代性失真** —— 再高的 quality 都回不來原始資訊,且 q95 還會讓檔案變大。無損切段僅移除 metadata 區塊,像素資料原封不動(約 50 行 JPEG marker 解析即可實作,已實測可行)。

### 0.5 對規劃的三個推翻

1. **「一個相依(Sharp)解掉三件事」是錯的。** EXIF 剝除與縮圖確實開箱即可、零風險;**HEIC 完全是另一回事** —— 不是設定問題,是專利問題。
2. **縮圖不需要背景工作。** 原以為要排 job(那就要動排程與狀態機);實測 24 MP → 240px 僅 28 ms,同步做即可。**大幅縮小範圍**。
3. **原本 OQ-IP-4 建議「重編碼後不保留原檔」是錯的。** Airtable 官方明載**不改原檔**,B2B 工具亦偏向保留;而重編碼是**世代性失真**。§0.4 實證出更好的第三條路:**無損切除 metadata 段** —— 像素位元組原封不動、GPS 消失,兩者兼得。OQ-IP-4 已據此改寫。

---

## 1. 目標與範圍

### 1.1 目標(P0)
1. **EXIF 剝除(優先無損)**|上傳時移除 GPS 等 metadata。**JPEG 以無損切段為主**(像素不動);僅當需要把 EXIF 方向燒進像素時才重新編碼(見 §4.1、OQ-IP-4)。
2. **伺服器縮圖**|上傳時同步產生縮圖,列表與記錄頁改讀縮圖(原圖僅於點開時取)。
3. **解壓縮炸彈防護**|顯式 `limitInputPixels`,不依賴 sharp 預設(實測擋不住)。
4. **HEIC 可用**|**前端轉檔**路線(見 OQ-IP-1),伺服器端不解 HEVC。

### 1.2 不做的事
- ❌ **伺服器端 HEIC 解碼**|專利曝險 + 自編 libvips 之長期維運代價(OQ-IP-1)。
- ❌ **裁切 / 浮水印 / 濾鏡**|非當前殘留。
- ❌ **回溯處理既有已上傳影像**|見 OQ-IP-6。
- ❌ **AVIF 輸出**|雖然預建版支援,但瀏覽器相容性與既有 webp 重疊,無新增價值。

---

## 2. 上游 / 既有現況走查

| 子題 | 現況 | Gap |
|---|---|---|
| 上傳管線 | ✅ `FilesService.upload`:magic bytes → 欄型 MIME 收斂 → 配額 → `storage.put` | 在 `put` 前插入處理階段 |
| 影像 MIME 白名單 | ✅ png / jpeg / gif / webp | HEIC 不在(現為 415) |
| 值契約 | ✅ `[{key,name}]`(attachment / image / signature 共用) | 縮圖 key 如何表達 → OQ-IP-3 |
| 前端預覽 | ✅ `useFilePreview`(fetch → blob → objectURL) | 改取縮圖 |
| sharp | ✅ 0.34.5 已在 node_modules(Next.js 傳遞相依);`onlyBuiltDependencies` 已列 | 加為 `apps/api` 直接相依 |
| 記憶體防護 | ❌ 無 | `limitInputPixels` + 併發限制 |

---

## 3. scope 切分

| 里程碑 | 內容 | 估算 |
|---|---|---|
| **M1 後端處理管線** | sharp 加為 api 直接相依 + `ImageProcessor`(rotate → 剝 EXIF → 縮圖 → `limitInputPixels`)+ 上傳時同步呼叫 + 單元/整合測 | 0.06 mo |
| **M2 縮圖儲存與讀取** | 縮圖 key 慣例 + `GET /api/files/:key?variant=thumb` + 孤兒回收涵蓋縮圖 | 0.04 mo |
| **M3 前端 HEIC 轉檔** | `accept` 收斂(觸發 iOS 自動轉檔)+ 非 Safari 以 WASM 轉檔 + 明確錯誤訊息 | 0.05 mo |
| **M4 收尾** | spec + FMEA + doc v1.0 + MODULES + 回填三處殘留 | 0.02 mo |

**合計 ≈ 0.17 mo**。前後端分開 commit。

---

## 4. 設計要點

### 4.1 處理管線(M1)
```
上傳 → magic bytes 判型 → 欄型 MIME 收斂 → 【新】影像處理 → 配額(以處理後大小計)→ 落儲存
                                              │
                                              ├─ 主檔:讀 EXIF orientation
                                              │   ├ orientation ∈ {1, 無} → **無損切段**(APP1/APP13),像素零改動
                                              │   └ 否則              → sharp .rotate() 重編碼(方向燒進像素)
                                              └─ 縮圖:.rotate() → resize(inside, 不放大) → webp
```
- **絕不呼叫 `withMetadata()` / `keepExif()` / `keepMetadata()`** —— 那會把 GPS 放回去,直接違反本模組目的(§12 P2)。
- **縮圖一律走 `.rotate()`** —— Teable changelog 實證:忽略 EXIF orientation 會讓 iPhone 照片縮圖轉向錯誤。
- **永不放大**(承 Ragic:50×50 原圖之縮圖仍為 50×50)。
- 配額以**處理後**大小計(主檔 + 縮圖)。

### 4.2 HEIC(M3;OQ-IP-1)
- 前端 `accept="image/jpeg,image/png,image/webp,image/gif"` → **iOS Safari 自動轉 JPEG**。
- 非 Safari(Android Chrome / 桌面)使用者若仍選到 HEIC → 以 WASM 於**使用者裝置**轉檔後再上傳。
- 後端維持不接 HEIC,但錯誤訊息要具體(「iPhone 照片請改用…」而非「不支援的檔案類型」)。

---

## 10. 開放問題(OQ-IP-N)— ✅ 已裁定 2026-07-28(全採建議)

| # | 議題 | 選項 | 建議 |
|---|---|---|---|
| **OQ-IP-1** ⭐ | HEIC 在哪裡解 | A. **前端轉檔**(iOS 自動 + 非 Safari 用 WASM),伺服器不碰 HEVC<br>B. 伺服器自編 libvips(libheif + libde265)<br>C. 不支援 HEIC,只改善錯誤訊息 | **A** — B 的**授權**可解(只做解碼、排除 x265 → LGPL,合 OSS-only),**但專利不可解**:Access Advance 明文把雲端服務納入按 authorized-user 計費,Weyver 正是商用多租戶 SaaS;且要付出多階段 Docker / C++ toolchain / libvips 版本鎖死 / 源碼重建 sharp 的長期維運。A 把解碼移到使用者裝置,專利與運算成本一併消失。C 太保守:iPhone 是 pilot 客戶現場拍照的主力 |
| **OQ-IP-2** | 縮圖同步或背景 | A. **上傳時同步**<br>B. 背景 job | **A** — 實測 24 MP → 240px 僅 **28 ms**,遠低於上傳本身的網路耗時;B 要引入佇列與「縮圖尚未就緒」的狀態機,複雜度不成比例 |
| **OQ-IP-3** | 縮圖如何定址 | A. **衍生 key 慣例**(`{key}.thumb.webp`)<br>B. `file_object` 加 `thumb_key` 欄<br>C. 縮圖另立一列 | **A** — 零 migration;縮圖是原檔的**衍生物**非獨立資產,不需自己的生命週期。刪除/回收原檔時一併處理即可。**代價**:key 形狀白名單需放寬以容納後綴 → 須同步更新 `KEY_RE`(FMEA) |
| **OQ-IP-4** ⭐ | 主檔如何剝除 EXIF | A. 重編碼剝除(不保留原檔)<br>B. 完全保留原檔(Airtable 作法)<br>C. **無損切除 metadata 段;僅方向需正規化時才重編碼** | **C(v0.2 改寫;原建議 A 已被證據推翻)** — **B 是 Airtable 明載作法**(「does not modify the underlying file」),但**Partiful 2025-10 事故**證明「原檔含 GPS」是真實可外洩風險(TechCrunch 揭露後兩日修補並回溯清洗)。**A 的代價過高**:重編碼是世代性失真,§0.4 實測 q95 甚至讓檔案**變大 14%**。**C 兩者兼得** —— 已實測:切除 APP1/APP13 後 EXIF 消失、**壓縮資料位元組完全相同**,等於 Airtable 的「不改檔案」精神(不動像素)同時消除 GPS。**殘留代價**:iPhone 直拍常為 orientation 6,那些仍需重編碼才能正確顯示;PNG/WebP 之 metadata 罕含 GPS,可先只處理 JPEG |
| **OQ-IP-5** | `limitInputPixels` 取值 | A. **50 MP**<br>B. sharp 預設 268 MP<br>C. 依 env 可調 | **A** — 實測真實 iPhone 照片為 149.8 MP(全景),但那是極端;50 MP 涵蓋絕大多數手機主鏡頭(48MP 級)。B 已證實擋不住 450 MB 的解碼。超限回明確訊息而非 500 |
| **OQ-IP-6** | 既有已上傳影像 | A. **不回溯**,只對新上傳生效<br>B. 寫一次性回溯 job | **A** — 回溯需重讀重寫全部既有檔案(跨租戶、耗時、可能失敗一半);目前 pilot 期影像量少。**誠實標註**:既有檔案仍含 EXIF → doc 明列,必要時再補 B |
| **OQ-IP-7** | 縮圖規格 | A. **單一尺寸:webp,長邊 320px,永不放大**<br>B. 兩種尺寸(比照 Teable sm/lg)<br>C. 三種(比照 Airtable) | **A** — **Ragic 只有一個縮圖**(預設高 120px、可設上限、**永不放大**),我們是 Ragic-parity-first;320px = 120–160px 顯示框的 2× retina 餘裕。webp 為 2026 業界預設(同畫質小 25–34%)。B/C 之多尺寸價值在 responsive srcset,而我們的使用場景只有「格內縮圖 / 展開預覽 / 原檔」三態,原檔已覆蓋後二者。**永不放大**明確承 Ragic 語意 |
| **OQ-IP-9** | 是否附帶縮圖重生工具 | A. **不做**,缺縮圖時前端退回原圖<br>B. 建重生 job | **A** — **Teable changelog 實證預生成派必須自建重生**(「regenerated thumbnails」「recovery for missing thumbnails on older attachments」);但我們以「缺縮圖 → 前端自動退回原圖」取代,行為上永不壞,且省掉一整套重生機制。日後若縮圖規格要改版,再補 B |
| **OQ-IP-8** | 非 Safari 的 WASM 轉檔是否納入 P0 | A. **納入**(`heic-to`,LGPL,2026-05 仍活躍)<br>B. P1,先只靠 iOS 自動轉檔 | **B** — iOS Safari 自動轉檔已覆蓋「iPhone 拍照上傳」這個主要情境(且該情境正是需求來源);Android 拍照本就多為 JPEG。WASM 為 ~1.2MB 額外載荷,先不進 P0。**證據強度提醒**:iOS 自動轉檔為社群回報非 Apple 官方文件 → **M3 必須實機/模擬驗證**,若不成立則本條升為 A |

---

## 12. 失效場景反思(FMEA)— ✅ M4 確認(2026-07-28)

| # | 場景 | 緩解 | Sev | 狀態 |
|---|---|---|---|---|
| P1 | **解壓縮炸彈**:小檔宣告巨大尺寸 → 解碼 OOM | `limitInputPixels = 50 MP` 於**每一次** sharp 建構(metadata / 主檔 / 縮圖三處皆帶);超限回 **413 `IMAGE_TOO_LARGE`** 明確訊息 | P0 | ✅ 已緩解(單元測以 8000×8000 PNG 斷言 413) |
| P2 | 誤用 `withMetadata()` / `keepExif()` → GPS 被放回 | `image-processor.ts` 檔頭以 ⚠️ 明載禁用;單元測直接斷言輸出 `metadata().exif` 為 `undefined`(測試圖刻意寫入 GPS) | P0 | ✅ 已緩解 |
| P3 | 剝 EXIF 後照片方向跑掉(橫躺) | orientation > 1 → `.rotate()` 重編碼把方向燒進像素;縮圖**一律** `.rotate()`。單元測以 orientation 6 之圖斷言「寬高互換 + 標籤消失」 | P1 | ✅ 已緩解 |
| P4 | 縮圖 key 後綴破壞既有 key 形狀白名單 → 下載被擋 | `KEY_RE` 放寬為 `…(\.thumb)?(\.[A-Za-z0-9]{1,8})?$`;`thumbnailKeyOf()` 為唯一產生處(伺服器端),並補測「衍生 key 仍符合白名單」 | P1 | ✅ 已緩解 |
| P5 | 處理失敗(損毀檔 / 不支援)導致整個上傳失敗或落半成品 | 解碼失敗 → **422 `IMAGE_UNREADABLE`**,**不**落儲存(先處理再落地);縮圖失敗僅 warn 不阻斷 | P1 | ✅ 已緩解(實作期由假 PNG fixture 觸發而補齊) |
| P6 | 同步處理拖慢上傳 / 併發吃滿 CPU | 實測 28 ms;既有 20 MB 上傳上限 + throttler 為前置閘 | P1 | ⚠️ **部分**|`sharp.concurrency` 與 Cloud Run `MALLOC_ARENA_MAX` **尚未設定** → 併入部署硬化(docs/11 §16),pilot 前補 |
| P7 | 既有已上傳影像仍含 EXIF | **不回溯**(OQ-IP-6=A) | P1 | ⚠️ **已知殘留,刻意接受**。Partiful 事故先例中修補方**有**回溯清洗 → **pilot 上線前應複查影像量並考慮補做** |
| P8 | 跨平台 lockfile 缺目標平台二進位 → 部署失敗 | — | P1 | ⚠️ **未緩解**|`supportedArchitectures` 尚未設定(目前僅本機 darwin-arm64)。**首次容器化部署必踩** → 列入部署前置 |
| P9 | iOS 自動轉檔的前提不成立 → iPhone 使用者仍被擋 | `accept` 不含 `image/heic`(觸發 iOS 自動轉 JPEG);**若不成立**則啟用 OQ-IP-8=A(WASM `heic-to`) | P1 | ⚠️ **前提仍未驗證** —— 桌面 Playwright harness 無法測 iOS Safari 的檔案選擇器行為,**只能實機驗**。降級路徑已備妥:後端 `UNSUPPORTED_FILE_TYPE` 訊息已明確指引 iPhone 使用者(不是「不支援的檔案類型」一句),即使前提不成立也不會無所適從 |
| P10 | 縮圖產生失敗或缺漏 → 版面破圖 | `?variant=thumb` 取不到縮圖時後端**回原檔**;前端無分支邏輯 | P2 | ✅ 已緩解(e2e 斷言縮圖端點恆 200) |

**P0 全數緩解**;殘留 4 項均為 P1/P2 且歸屬明確(P6/P8 → 部署硬化、P7 → pilot 前決策、P9 → 實機驗證)。

---

## 13. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-07-28 | **v1.0 SHIPPED** | M1–M4 完成。**M1** `ImageProcessor`(無損切段 `stripJpegMetadata` + `.rotate()` 正規化 + 320px webp 縮圖 + 50MP 上限)+ 9 單元測;**M2** `thumbnailKeyOf` 衍生 key + `?variant=thumb` 端點(無縮圖回原檔)+ 孤兒回收涵蓋縮圖 + `KEY_RE` 放寬;**M3** `useFilePreview` 預設取縮圖、`accept` 排除 HEIC、`describeEngineError` 三則可行動訊息;**M4** `image-processing.spec` 3 e2e + FMEA 確認。**實作期兩個發現**:(a) 假 PNG fixture 觸發 500 → 補齊設計中已列但未實作的 **422 `IMAGE_UNREADABLE`**;(b) `Content-Length` 誤用 `file_object.size`(已含縮圖之配額)導致下載截斷 → 改取 `storage.stat()`。**未做**:OQ-IP-8 WASM(P1)、P6/P8 部署硬化、P7 回溯 | Claude Code |
| 2026-07-28 | **v0.2** | **競品研究後改寫**(站在巨人肩膀上)。§0.3 加競品實作對照:Ragic **1 個縮圖 / 預設高 120px / 永不放大**;Airtable **官方明載不改原檔**、3 縮圖、URL 2 小時過期;Teable 2 縮圖且 **changelog 實證「縮圖忽略 EXIF orientation」之坑**與「預生成必須自建重生」之代價;Dropbox 提供**客戶端以 JPG 上傳**(支持前端轉檔路線);**Partiful 2025-10 GPS 外洩事故**(TechCrunch,兩日修補並回溯清洗)。§0.4 實測重編碼 vs 無損切段。**推翻原 OQ-IP-4 建議**:改採**無損切除 metadata 段**(像素位元組不動,等同 Airtable「不改檔案」精神又消除 GPS);OQ-IP-7 以 Ragic 規格錨定(單一尺寸、永不放大);新增 OQ-IP-9(不建重生工具,改以「缺縮圖退回原圖」)| Claude Code |
| 2026-07-28 | v0.1 | 初版 DRAFT — 收斂 image-signature-fields S3/S4/HEIC 與 file-storage 之縮圖殘留。**§0.1 本機實測**推翻兩項前提:(a) HEIC **不是**加相依就能解 —— 我們的 sharp 預建版無 HEVC 解碼器,且維護者已表態永不內含(專利);(b) 縮圖**不需背景 job** —— 實測 24MP→240px 僅 28ms。另實測發現 **1.6MB 檔案可宣告 149.8MP**,sharp 預設 pixel 上限擋不住(解碼約需 450MB)→ 列 P0。**§0.2 網路研究**:授權可解(LGPL,decode-only 避開 x265 GPL)但**專利不可解**(HEVC 池明文涵蓋雲端服務按用戶計費)→ HEIC 走前端轉檔。P0 = EXIF 剝除 + 同步縮圖 + 炸彈防護 + 前端 HEIC 路徑。OQ-IP-1..8 待裁定 | Claude Code |
