# image-processing.md — [F-7] 影像處理(EXIF 剝除 / 縮圖 / HEIC)設計文件

> ⏳ **狀態:DRAFT — OQ-IP-1..8 待裁定**
>
> **收斂三個模組共同記錄的 P1 殘留**(皆註明「需影像處理相依,同批補」):
> - `image-signature-fields` §12 **S4**|照片 EXIF 含 GPS / 裝置資訊外流 —— P0 無剝除能力
> - `image-signature-fields` §12 **S3**|無伺服器縮圖,原圖直出拖慢列表
> - `image-signature-fields` §1.2|**HEIC/TIFF 不支援**(iPhone 原生格式)
> - `file-storage` P1|縮圖 Sharp
>
> 作者:Claude Code(草擬)
> 版本:v0.1(2026-07-28)

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
| **1.6 MB 檔案宣告 149.8 MP** | sharp 預設 `limitInputPixels` = 268 MP → **擋不住** | 解成 raw RGB ≈ **450 MB**;20 MB 上傳上限**完全不約束解碼期記憶體** |
| 顯式 `limitInputPixels: 12M` | ✅ `Input image exceeds pixel limit` | 緩解有效 |
| 24 MP → 240px 縮圖 | **28 ms** | **同步處理可行,不需背景 job / 佇列** |

### 0.2 網路研究(sharp 官方文件 / 維護者聲明 / 專利池條款)

1. **sharp 預建二進位永遠不會含 HEIC** —— 維護者 2025-11 於 issue #4479 明確表態:提供源碼不受專利拘束,提供**能處理專利技術的二進位**則不同;以 sharp 下載量估授權費約 **US$25m/年**。這是**永久政策**,不是待辦。
2. **授權不是問題,專利才是**|libheif / libde265 為 **LGPL**(自由軟體;SaaS 不散布二進位故 copyleft 不觸發,亦非 AGPL);x265 為 GPL 但那是**編碼器**,只做解碼可完全不編入。**但** Access Advance(HEVC 專利池)條款**明文將雲端服務納入**,decoder「used to provide or made available for use through Cloud-Based Services」按 authorized user 逐年計費 —— Weyver 是商用多租戶 SaaS,落在其收費範圍。
3. **iOS Safari 會自動轉檔**|`<input type="file">` 之 `accept` **不含** `image/heic` 時,系統自動把 HEIC 轉成 JPEG 才送出(社群普遍回報,非 Apple 官方文件 → 證據強度中)。
4. **`ignore-scripts` 不是障礙**|sharp ≥ 0.33 改用 optionalDependencies + cpu/os/libc 篩選,**已無 install script**;「sharp 需要 ignore-scripts=false」是 0.33 前的過期資訊。本專案 `pnpm.onlyBuiltDependencies` 已列 sharp,且 sharp 0.34.5 **已在 node_modules**(Next.js 傳遞相依)。
5. **容器坑**|glibc 與 musl 是不同套件;跨平台安裝需 `supportedArchitectures`;glibc 記憶體碎片化建議設 `MALLOC_ARENA_MAX`(Cloud Run 有記憶體上限)。

### 0.3 對規劃的兩個推翻

1. **我先前說「一個相依(Sharp)解掉三件事」是錯的。** EXIF 剝除與縮圖確實開箱即可、零風險;**HEIC 完全是另一回事** —— 不是設定問題,是專利問題。
2. **縮圖不需要背景工作。** 原以為要排 job(那就要動排程與狀態機);實測 24 MP → 240px 僅 28 ms,同步做即可。**大幅縮小範圍**。

---

## 1. 目標與範圍

### 1.1 目標(P0)
1. **EXIF 剝除**|影像類欄位(image / signature / attachment 之影像檔)上傳時剝除全部 metadata;**先 `.rotate()` 把方向燒進像素**再剝,避免照片轉向。
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
                                              ├ sharp(buf, { limitInputPixels })
                                              ├ .rotate()        方向燒進像素 + 移除 orientation
                                              ├ 輸出原尺寸(剝除全部 metadata,預設行為)
                                              └ 縮圖 resize(inside) → webp
```
- **絕不呼叫 `withMetadata()` / `keepExif()` / `keepMetadata()`** —— 那會把 GPS 放回去,直接違反本模組目的(§12 P1)。
- 配額以**處理後**大小計(剝 EXIF + 可能重新編碼後才是實際佔用)。

### 4.2 HEIC(M3;OQ-IP-1)
- 前端 `accept="image/jpeg,image/png,image/webp,image/gif"` → **iOS Safari 自動轉 JPEG**。
- 非 Safari(Android Chrome / 桌面)使用者若仍選到 HEIC → 以 WASM 於**使用者裝置**轉檔後再上傳。
- 後端維持不接 HEIC,但錯誤訊息要具體(「iPhone 照片請改用…」而非「不支援的檔案類型」)。

---

## 10. 開放問題(OQ-IP-N)— 待裁定

| # | 議題 | 選項 | 建議 |
|---|---|---|---|
| **OQ-IP-1** ⭐ | HEIC 在哪裡解 | A. **前端轉檔**(iOS 自動 + 非 Safari 用 WASM),伺服器不碰 HEVC<br>B. 伺服器自編 libvips(libheif + libde265)<br>C. 不支援 HEIC,只改善錯誤訊息 | **A** — B 的**授權**可解(只做解碼、排除 x265 → LGPL,合 OSS-only),**但專利不可解**:Access Advance 明文把雲端服務納入按 authorized-user 計費,Weyver 正是商用多租戶 SaaS;且要付出多階段 Docker / C++ toolchain / libvips 版本鎖死 / 源碼重建 sharp 的長期維運。A 把解碼移到使用者裝置,專利與運算成本一併消失。C 太保守:iPhone 是 pilot 客戶現場拍照的主力 |
| **OQ-IP-2** | 縮圖同步或背景 | A. **上傳時同步**<br>B. 背景 job | **A** — 實測 24 MP → 240px 僅 **28 ms**,遠低於上傳本身的網路耗時;B 要引入佇列與「縮圖尚未就緒」的狀態機,複雜度不成比例 |
| **OQ-IP-3** | 縮圖如何定址 | A. **衍生 key 慣例**(`{key}.thumb.webp`)<br>B. `file_object` 加 `thumb_key` 欄<br>C. 縮圖另立一列 | **A** — 零 migration;縮圖是原檔的**衍生物**非獨立資產,不需自己的生命週期。刪除/回收原檔時一併處理即可。**代價**:key 形狀白名單需放寬以容納後綴 → 須同步更新 `KEY_RE`(FMEA) |
| **OQ-IP-4** ⭐ | 是否保留原始檔(含 EXIF) | A. **不保留**,儲存的即為已剝除版<br>B. 保留原檔另存剝除版 | **A** — B 等於「隱私資料仍在我們手上」,只是不給看,**沒有真正消除風險**(備份、稽核、資料外洩皆仍含 GPS)。**誠實代價**:這是**破壞性**的 —— 使用者無法取回原始 EXIF,且 JPEG 需重新編碼會有品質損失(以 quality 90 + 原尺寸緩解)。攝影類用途若日後有需求,再以欄位選項開放 |
| **OQ-IP-5** | `limitInputPixels` 取值 | A. **50 MP**<br>B. sharp 預設 268 MP<br>C. 依 env 可調 | **A** — 實測真實 iPhone 照片為 149.8 MP(全景),但那是極端;50 MP 涵蓋絕大多數手機主鏡頭(48MP 級)。B 已證實擋不住 450 MB 的解碼。超限回明確訊息而非 500 |
| **OQ-IP-6** | 既有已上傳影像 | A. **不回溯**,只對新上傳生效<br>B. 寫一次性回溯 job | **A** — 回溯需重讀重寫全部既有檔案(跨租戶、耗時、可能失敗一半);目前 pilot 期影像量少。**誠實標註**:既有檔案仍含 EXIF → doc 明列,必要時再補 B |
| **OQ-IP-7** | 縮圖格式與尺寸 | A. **webp,長邊 320px**<br>B. jpeg<br>C. 兩種都出 | **A** — webp 於相同品質下明顯較小,且瀏覽器支援已普及(我們已在 magic bytes 白名單內);320px 足夠列表與記錄頁縮圖(Ragic 預設 120px 高,我們留餘裕給 retina) |
| **OQ-IP-8** | 非 Safari 的 WASM 轉檔是否納入 P0 | A. **納入**(`heic-to`,LGPL,2026-05 仍活躍)<br>B. P1,先只靠 iOS 自動轉檔 | **B** — iOS Safari 自動轉檔已覆蓋「iPhone 拍照上傳」這個主要情境(且該情境正是需求來源);Android 拍照本就多為 JPEG。WASM 為 ~1.2MB 額外載荷,先不進 P0。**證據強度提醒**:iOS 自動轉檔為社群回報非 Apple 官方文件 → **M3 必須實機/模擬驗證**,若不成立則本條升為 A |

---

## 12. 失效場景反思(FMEA)— M4 收尾必填;pre-mortem 預列

| # | 場景 | 預定緩解 | Sev |
|---|---|---|---|
| P1 | **解壓縮炸彈**:小檔宣告巨大尺寸 → 解碼 OOM | 顯式 `limitInputPixels`(OQ-IP-5);**已實測 sharp 預設擋不住 1.6 MB / 149.8 MP** | P0 |
| P2 | 誤用 `withMetadata()` / `keepExif()` → GPS 被放回 | 程式碼註解明載禁用;測試斷言輸出**無** EXIF | P0 |
| P3 | 剝 EXIF 後照片方向跑掉(橫躺) | `.rotate()`(= autoOrient)先把方向燒進像素;測試以帶 orientation 的圖驗證 | P1 |
| P4 | 縮圖 key 後綴破壞既有 key 形狀白名單 → 下載被擋 | `KEY_RE` 同步放寬並補測;衍生 key 一律由伺服器生成 | P1 |
| P5 | 處理失敗(損毀檔 / 不支援)導致整個上傳失敗 | 處理失敗 → 明確 415/422 訊息;**不**落半成品到儲存 | P1 |
| P6 | 同步處理拖慢上傳 / 併發吃滿 CPU | 實測 28 ms;`sharp.concurrency` 設限 + 既有 throttler;Cloud Run 另設 `MALLOC_ARENA_MAX` 防 glibc 碎片化 | P1 |
| P7 | 既有已上傳影像仍含 EXIF | **已知殘留**(OQ-IP-6=A);doc 明列,不假裝已解決 | P1 |
| P8 | 跨平台 lockfile 缺目標平台二進位 → 部署失敗 | pnpm `supportedArchitectures` 明列 linux-x64-glibc;CI 驗證 | P1 |
| P9 | iOS 自動轉檔的前提不成立 → iPhone 使用者仍被擋 | **證據強度僅為社群回報** → M3 必須實測;不成立則啟用 OQ-IP-8=A(WASM) | P1 |

---

## 13. 變更紀錄

| 日期 | 版本 | 變更 | 作者 |
|---|---|---|---|
| 2026-07-28 | v0.1 | 初版 DRAFT — 收斂 image-signature-fields S3/S4/HEIC 與 file-storage 之縮圖殘留。**§0.1 本機實測**推翻兩項前提:(a) HEIC **不是**加相依就能解 —— 我們的 sharp 預建版無 HEVC 解碼器,且維護者已表態永不內含(專利);(b) 縮圖**不需背景 job** —— 實測 24MP→240px 僅 28ms。另實測發現 **1.6MB 檔案可宣告 149.8MP**,sharp 預設 pixel 上限擋不住(解碼約需 450MB)→ 列 P0。**§0.2 網路研究**:授權可解(LGPL,decode-only 避開 x265 GPL)但**專利不可解**(HEVC 池明文涵蓋雲端服務按用戶計費)→ HEIC 走前端轉檔。P0 = EXIF 剝除 + 同步縮圖 + 炸彈防護 + 前端 HEIC 路徑。OQ-IP-1..8 待裁定 | Claude Code |
