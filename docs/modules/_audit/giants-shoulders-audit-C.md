# giants-shoulders-audit-C.md — 「站在巨人的肩膀」**複查**(全 33 份)

| | |
|---|---|
| 稽核日期 | 2026-08-04 |
| 範圍 | `docs/modules/R1/` **全部 33 份**(A/B 兩輪之後的複查 + 其後新增的模組)|
| 判準來源 | `AGENTS.md`〈向上設計三條〉·〈🚫 第一約束〉· `memory/pitfall_giants_shoulders_three_stops` |
| 方法 | 三組平行稽核各 11 份;**兩條 🔴 由本人回一手複驗**(不採信轉述,見 §2)|
| 產出性質 | 稽核 + **就地更正兩處事實錯誤**(§4);未動 prod 邏輯 |

---

## 1. 一句話結論

**形式面已經好了 —— 33 份裡 30 份的第③站達到一手逐字,「競品沒有 X」這種未查證的句型本輪一件都沒查到。**
**但形式好不等於內容對:本輪最大的一條,是一份把「全文搜尋無命中」寫進誠實聲明的模組,而那次搜尋根本沒搜到。**

---

## 2. 🔴 兩條(本人一手複驗,非轉述)

### 2.1 `option-colors` 的承重前提是**錯的** —— Ragic 有 per-option 顏色

文件 §0.3 逐字:

> 「依據是 **582 頁本地鏡像全文搜尋無命中**」

複驗方式與結果(2026-08-04,本人執行):

```
grep -rl "設定選項顏色" ~/Documents/work_work/reference-materials/ragic-doc-zh-TW/
→ 5 個檔命中,含 doc/27「欄位種類」
```

Ragic 官方逐字(`doc/27`):

> 「**設定選項顏色** 為了方便辨識資料,你也可以設定選項顏色,勾選下方 **設定選項顏色** 後,
> 選項旁邊會有預設顏色圖示,**可以點擊圖示來變更顯示顏色**。可以勾選 **選項字體設為白色**……」
> (多選欄)「只有在分隔符號設為 **bubble** 時,選項才會**顯示顏色**」

🔴 **而命中的 `doc/27` 正是 `field-types-parity` 自己引用過的同一頁。**

**連鎖影響**|
- §0.1 推論 1「選項顏色不是 Ragic parity,是 Airtable 範式……不會解決任何遷移對不上的問題」→ **為偽,它就是 parity**
- OQ-OC-1 原建議 A 的理由 (c)「Ragic 無此功能,沒有遷移壓力」→ **為偽**
- ⚠️ 決策方當時**憑直覺翻成 B(完整色盤)** —— 也就是被錯誤前提推向錯誤建議,靠直覺救回來。**下一次不一定有這個運氣。**
- **新的 parity 缺口**(未複核):「選項字體設為白色」與「僅 bubble 分隔符顯色」,我方 12 tone 是否涵蓋

**這一條最值得記的地方**|
文件的**紀律是對的** —— 它寫了「未查到 ≠ 沒有」、標了證據強度「中」、
甚至預先寫下觸發條件「若日後發現 Ragic 有此功能,推論 1 與 OQ-OC-4 都要重看」。
**擋不住的是搜尋本身執行錯了。**
👉 **誠實聲明能防止「把沒查當查過」,但防不了「查了但查錯」。**
承重的否定式結論(「查不到 X」),**應在文件裡留下可複驗的指令**(如 `recycle-bin` §0.5 的做法),
否則下一個人只能選擇相信。

### 2.2 `formula-and-linkload` 標 SHIPPED,但 **Load 半邊沒有任何生產路徑**

複驗方式與結果(本人執行):

| 查法 | 結果 |
|---|---|
| `grep -rn "RelationService" apps/api/src` | 只有 `form-engine.module.ts` 註冊/匯出,**零個 controller 或 service 注入它** |
| `grep -rn "\.load(" apps/api/src`(排除測試) | 只有 `relation.service.ts:91` —— **`lookup()` 內部自呼** |
| lookup 實際實作在哪 | `record.service.ts:336` 的 `isSnapshotLookup(...)`,**與 RelationService 無關** |

也就是說 `RelationService` 是一個**註冊了、匯出了、有整合測試、但生產路徑上沒有人用**的服務;
而 OQ-FML-4=A 逐字裁定「Load 快照**複製進本記錄**、可編輯」與 §165「選記錄 UI」**都沒有落地**。
檔頭卻寫「✅ SHIPPED v1.0 — **M0–M6 全數達成**」。

⚠️ 這是 `pitfall_unread_schema_field_drift`(沒有 reader 的 schema 欄位)的**上一層形態**:
**沒有 caller 的 service**。而它比欄位更難發現,因為它有測試、測試會綠。

---

## 3. 🟡 五條

| # | 模組 | 問題 | 為什麼是 🟡 |
|---|---|---|---|
| 1 | `data-export` | **站② 從未回填**。三個 archiver 踩坑(`ZipArchive` 執行期不存在 / `processedBytes` 恆 0 / CJS interop)只留在 changelog | 下一個做匯出的人查不到,會再踩一次 |
| 2 | `workspace-ia` §14 | 站② 的依據**在寫下後 79 分鐘失效**(見 §4.2) | 結論仍成立,但依據已錯,且被複製進 prod 註解 |
| 3 | `grid-and-excel-import` §0-bis | 待辦清單**兩邊都過期**:分層取樣 200 與 `dense:true` 已做但清單仍寫沒做;`allMatch` 100% 門檻 / `cellDates` / 逃生鍵仍缺但沒被追 | 典型 `pitfall_stale_todo_already_done`,而且是雙向 |
| 4 | `views-group-kanban-calendar` | 檔頭已撤回 NocoDB 引用,但 §0.8 來源清單**仍掛 `nocodb/.../group-by.ts` 原始碼連結**;另:kanban `KeyboardSensor` 程式已修但 doc 全文零筆 a11y 記載 | 清單漏刪會讓下一個人以為那條路可以走 |
| 5 | `AGENTS.md` §5-bis | 逐字寫「`pivot-and-charts` §0 同此處置,**已標註**」,但 pivot §0 導言仍停在「凡以 Metabase 原始碼為唯一依據的結論標為**待複核**」 | **規則文件過度宣稱** —— 這正是 `pitfall_rule_without_check_always_drifts` 的形態 |

---

## 4. 本輪就地更正(兩處)

### 4.1 `option-colors` §0.3 —— 依 §2.1 改寫

把「全文搜尋無命中」更正為官方逐字,並把連鎖影響與新 parity 缺口寫進文件。

### 4.2 `workspace-ia` §14.0 站② —— 自我更正

原文逐字:「**沒有**。`packages/ui` 無 dialog,**全 repo 零個 `role="dialog"`**」。

實測(2026-08-04):`grep -rn 'role="dialog"' apps packages` → **2 命中**,
其一是 `apps/web/src/components/form/date-input.tsx`(自製月曆彈層)。

git 時序:§14 落地 `c2f2cc8`(**07:37**)· date-input `b28fc35`(**08:56**)——
**是同一天稍後由本人加上的**。結論(不為此引入 modal 相依)仍成立,但依據已失效,
且**同一句話被複製進 `form-workspace.tsx` 的註解**,日後會被當成事實讀。

👉 教訓:**「全 repo 零個 X」是有保鮮期的斷言。** 寫它的時候要標日期,
或者乾脆改寫成不會過期的形式(「當時沒有現成元件,故不引入新相依」)。

---

## 5. 已補救的(對照文件現況,不採信清單)

| 上一輪待辦 | 現況 | 複驗方式 |
|---|---|---|
| ZEN 裝了沒用 | ✅ 已移除 | `grep zen-engine` 三份 package.json 零命中 |
| `form-designer-2d` 補三站 | ✅ 三站皆一手逐字 | 🔴→🟡 |
| `colWidths` / `rowHeights` 與 OQ-FDW-7 衝突 | ✅ 已移除且明文收斂「依據②不成立,裁定維持」 | prod code 僅剩移除說明註解 |
| layout 整表 PUT 並發覆寫 | ✅ 已修為 `expectedVersion` 條件式 UPDATE | 讀 metadata service |
| ARI 補 Ragic 一手 | ✅ §10-ter,且自承 §10-bis 指錯路徑並更正 | `doc/32` 五級權限表逐字命中 |
| `image-signature` 補《電子簽章法》 | ✅ §0-bis 五小節 + 582 頁詞頻全 0 | UI 明示亦已落地(`field-settings.tsx` / `signature-input.tsx` 各一行) |
| clean-room 規則兩套互斥 | ✅ `AGENTS.md` §5-bis 立表,含 MES 生態逐一複驗 LICENSE | — |
| `views-group` 記錄 TanStack 評估 | ✅ §0.7-bis,`ColumnGrouping.d.ts` L152 逐字屬實 | 讀已安裝型別檔 |
| `grid-paste` fill handle 歸屬 | ✅ 改列本模組 P1,理由更正為「資料路徑那半是錯的」 | `data-grid.d.ts:77` / `data-editor.d.ts:64` |
| OQ-WIA-8 首頁形態未落地 | ✅ 早已上線(`PendingApprovals` / `RecentForms` / `notification-bell`) | 又一次「待辦其實早就做完」 |

---

## 6. 未結案清單(→ task)

| # | 事項 | 模組 | 等級 |
|---|---|---|---|
| 1 | Load 半邊落地或**改寫檔頭狀態**(不得續稱 M0–M6 全數達成) | `formula-and-linkload` | 🔴 |
| 2 | option-colors 依 §2.1 重看 OQ-OC-4 優先序 + 查「白字」「bubble 顯色」parity | `option-colors` | 🔴 |
| 3 | 站② 回填(archiver 三個踩坑) | `data-export` | 🟡 |
| 4 | §0.8 來源清單刪 NocoDB 原始碼連結 + 補 kanban a11y 記載 | `views-group` | 🟡 |
| 5 | `AGENTS.md` §5-bis 的「已標註」與 pivot §0 對不上 —— 二選一 | `AGENTS.md` / `pivot-and-charts` | 🟡 |
| 6 | `grid-and-excel-import` §0-bis 清單雙向過期 | `grid-and-excel-import` | 🟡 |
| 7 | 未結:authz 三條旁路 / conditional-format C-3 / approval-advanced 主管遷移 | 三份 | 🟡 |

---

## 7. 稽核本身的限制(誠實聲明)

- **線上 URL 一律未複核**(Salesforce KB、全國法規、GitHub/GitLab/Jira/Zulip、NIST、CVE、Metabase/Teable 線上頁)。
  只複核本地鏡像可對照者。
- **站② 只複驗了** `@glideapps/glide-data-grid@6.0.3`、`@tanstack/table-core@8.21.3`、
  `better-auth@1.6.23`、`next-intl` 與日期庫的**安裝狀態**;SheetJS / archiver / antlr4ts **未複驗**。
- 各模組自述的實測(`dynamic-permissions` 30 萬列、`full-text-search` pg_bigm、
  `notifications` PG18 壓測、`recycle-bin` attnum、`date-and-display-format` 跨語系截圖)**一律未重跑**。
- **未評估實作品質**,只評估「決策是否站在證據上」;未跑任何測試。
- §2 的兩條 🔴 由本人一手複驗;**§3 的五條 🟡 採信分組稽核的驗證敘述,未逐條重驗**。
