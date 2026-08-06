# 研究索引(**本檔為產生檔,勿手改**)

> 由 `packages/docs-check/src/research-index.ts` 從模組 doc 掃出來,
> `research-index.test.ts` 斷言它與重新產生的一致 —— **漂移在 CI 就會紅**。
> 要改內容請改**模組 doc**,不要改這一份。

## 這份索引要解的問題

「我要做 X 了,先去查 Ragic 怎麼做」—— 而那份查證**可能三個月前就做過了**,
只是躺在另一個模組的 doc 裡。重複查證最貴的不是時間,
是**兩次查出不同結論卻沒人發現**。

⚠️ 研究強度是**導航訊號不是評分**:⭐⭐ 可直接信;· 零星引用者仍須自己複核。
⚠️ **競品的功能會變**。索引只告訴你「誰查過」,不保證「現在仍然如此」——
承重的斷言仍須看該 doc 內記的**查證日期**。

## A. 已出貨且研究齊全的模組(**別重查**)

| 模組 | 研究強度 | 出處連結 | 逐字 | Ragic doc | 其他來源 | 文件 |
|---|---|---|---|---|---|---|
| [F-2] 認證 + 租戶 context + 使用者身分 | ⭐ 有一手依據 | 10 | 0 | — | ASVS · Better Auth · CVE-2025-61928 · CVE-2025-64484 · CVE-2026-35051 · CVE-2026-53513 · CVE-2026-53514 · Fastify · NestJS · OWASP | [foundation/auth.md](foundation/auth.md) |
| [F-5] 檔案儲存基礎設施(上傳 / 下載 / 附件欄完成) | ⭐ 有一手依據 | 11 | 0 | — | Airtable · CVE-2025-24033 · CVE-2026-25223 · CVE-2026-33806 · CVE-2026-3635 · ClamAV · Fastify · NestJS · OWASP | [foundation/file-storage.md](foundation/file-storage.md) |
| [F-9] 框架升版(NestJS 11 + Fastify 5) | ⭐⭐ 深且推翻過 | 34 | 1 | — | Better Auth · CVE-2025-32442 · CVE-2026-25223 · CVE-2026-33806 · CVE-2026-3635 · ClamAV · Fastify · NestJS | [foundation/framework-upgrade.md](foundation/framework-upgrade.md) |
| [F-7] 影像處理(EXIF 剝除 / 縮圖 / HEIC) | ⭐⭐ 深且推翻過 | 12 | 5 | `148` | Airtable · Baserow · Teable | [foundation/image-processing.md](foundation/image-processing.md) |
| [F-11] 上傳掃毒 + presigned 混合下載 | ⭐⭐ 深且推翻過 | 19 | 0 | — | CVE-2020-7613 · CVE-2025-20128 · CVE-2025-20234 · CVE-2025-20260 · CVE-2026-20213 · ClamAV · OWASP | [foundation/malware-scanning.md](foundation/malware-scanning.md) |
| [F-4] 二步驟驗證(MFA / TOTP) | ⭐⭐ 深且推翻過 | 12 | 1 | — | Better Auth · OWASP · Salesforce | [foundation/mfa.md](foundation/mfa.md) |
| [F-10] 分頁級租戶上下文(修跨分頁污染) | ⭐ 有一手依據 | 11 | 3 | — | Better Auth · Notion · OWASP · Shopify | [foundation/tenant-context.md](foundation/tenant-context.md) |
| [R1·後續-1] 自訂按鈕 + 簽核流程(workflow UX 面) | ⭐⭐ 深且推翻過 | 15 | 0 | `13` `15` `68` | Airtable · NestJS · Odoo · SAP · Salesforce · ServiceNow · Teable | [R1/actions-approval.md](R1/actions-approval.md) |
| [R1·後續-1b] 簽核進階語意(動態簽核人 / 會簽擇辦 / 加簽 / 退回 / 不可竄改) | ⭐⭐ 深且推翻過 | 21 | 11 | `13` `15` | Kissflow · Odoo · SAP · Salesforce · ServiceNow | [R1/approval-advanced.md](R1/approval-advanced.md) |
| [P0-4a·uplift] 資源軸繼承(分類授權 + owner + 敏感旗標) | ⭐ 有一手依據 | 0 | 11 | `0` `11` `32` | Airtable · Notion · Odoo · Salesforce | [R1/authz-resource-inheritance.md](R1/authz-resource-inheritance.md) |
| [P0-4a] 三層權限(授權層) | ⭐ 有一手依據 | 19 | 1 | `32` `64` | Airtable · Baserow · Better Auth · CVE-2019-11780 · CVE-2024-12368 · CVE-2024-36259 · NestJS · NocoDB · Odoo · Salesforce | [R1/authz.md](R1/authz.md) |
| [R1·UP-3b] 條件式格式(form-designer-2d P1 解鎖) | ⭐ 有一手依據 | 5 | 28 | `6` | Airtable · Baserow · NocoDB · Teable | [R1/conditional-format.md](R1/conditional-format.md) |
| R1·I-1|資料匯出(帶得走的完整副本) | ⭐ 有一手依據 | 0 | 10 | — | ASVS · Better Auth · GDPR · NestJS · OWASP · Salesforce | [R1/data-export.md](R1/data-export.md) |
| [R1·FMT] 日期輸入與顯示格式 | ⭐ 有一手依據 | 0 | 15 | `51` | ARIA APG · Airtable · W3C | [R1/date-and-display-format.md](R1/date-and-display-format.md) |
| [E-1] 動態權限(記錄範圍 + 指派) | ⭐⭐ 深且推翻過 | 14 | 6 | `32` `54` | Airtable · Baserow · NocoDB · Notion · Odoo · Salesforce · Teable | [R1/dynamic-permissions.md](R1/dynamic-permissions.md) |
| [R1·UP-4] 欄位型別 parity（form-engine-core 增量） | ⭐⭐ 深且推翻過 | 63 | 16 | `14` `20` `25` `27` `31` `145` `153` `295` `344` `357` | Airtable · Baserow · NocoDB · Notion · Odoo · SAP · Salesforce · Teable | [R1/field-types-parity.md](R1/field-types-parity.md) |
| [R1·UP-3] 2D 表單設計器（form-designer-ui uplift） | ⭐ 有一手依據 | 0 | 24 | `21` `35` `121` `306` | Airtable · Baserow · NocoDB · Teable | [R1/form-designer-2d.md](R1/form-designer-2d.md) |
| [P0-1·UI] 表單設計器 + 填單 接引擎 API | ⭐⭐ 深且推翻過 | 12 | 0 | `21` `37` `72` `143` `167` `286` | Airtable · Baserow · Notion · Salesforce · W3C · Zoho | [R1/form-designer-ui.md](R1/form-designer-ui.md) |
| [R1·UP-3c] 設計檢視 = 表單本身（設計器心智模型補完） | ⭐ 有一手依據 | 0 | 12 | `21` `26` `34` `35` `37` `38` `53` `121` `306` | Airtable · Baserow · Teable | [R1/form-designer-wysiwyg.md](R1/form-designer-wysiwyg.md) |
| [P0-3] 公式引擎 + 關聯 Link&Load | ⭐ 有一手依據 | 1 | 10 | — | Airtable · Baserow · Glide Data Grid · NocoDB · Notion · Salesforce · Teable | [R1/formula-and-linkload.md](R1/formula-and-linkload.md) |
| [R1·UX-1] 前端重構(視覺 / 心智模型 / 操作體驗 / UI / UX) | ⭐ 有一手依據 | 0 | 15 | — | ARIA APG · Airtable · Baserow · Glide Data Grid · NocoDB · Notion · SAP · Salesforce · W3C | [R1/frontend-uplift.md](R1/frontend-uplift.md) |
| [P0-2] 網格主檢視 + Excel 建表 onboarding | ⭐⭐ 深且推翻過 | 14 | 2 | `41` `54` `65` | Airtable · Glide Data Grid · Salesforce · Teable | [R1/grid-and-excel-import.md](R1/grid-and-excel-import.md) |
| [R1·P0-2 殘留] 網格貼上 Excel 區塊 | ⭐ 有一手依據 | 0 | 15 | `107` `139` `210` | Airtable · Baserow · Glide Data Grid · Smartsheet · Teable | [R1/grid-paste.md](R1/grid-paste.md) |
| [R1·UP-4b] 圖片欄 + 簽名欄(field-types-parity P1 解鎖) | ⭐ 有一手依據 | 1 | 6 | `15` `27` | Airtable · Baserow · Teable | [R1/image-signature-fields.md](R1/image-signature-fields.md) |
| [R1·#106] 匯入既有表單(upsert + 撤銷) | ⭐⭐ 深且推翻過 | 32 | 6 | `41` `65` `81` `91` `232` | Airtable · Baserow · NocoDB · Notion · Odoo · Salesforce · Shopify · Zoho | [R1/import-to-existing-form.md](R1/import-to-existing-form.md) |
| [R1·LNK] 連結欄選記錄 + Load 帶入 | ⭐ 有一手依據 | 0 | 8 | `14` | Airtable · Teable | [R1/link-picker-and-load.md](R1/link-picker-and-load.md) |
| [H-1] 通知系統(訂閱 / 提醒 / 通道) | ⭐⭐ 深且推翻過 | 12 | 4 | `5` `12` `32` `78` `94` `96` | Airtable · CVE-2019-11544 · CVE-2021-39119 · CVE-2021-41312 · Fastify · Notion · Teable | [R1/notifications.md](R1/notifications.md) |
| [R1·UP-4c] 選項顏色設定 UI(field-types-parity P1 解鎖) | ⭐ 有一手依據 | 0 | 6 | `6` `27` | Airtable · Baserow · NocoDB · Teable | [R1/option-colors.md](R1/option-colors.md) |
| [F-2] 樞紐分析 + 圖表 | ⭐⭐ 深且推翻過 | 50 | 27 | `7` `9` `22` `27` `32` `42` `58` `86` `90` `99` `122` `137` | Airtable · Baserow · CVE-2024-55951 · Metabase · NocoDB · Notion · Salesforce · Teable | [R1/pivot-and-charts.md](R1/pivot-and-charts.md) |
| [R1·後續-2] 標籤/QR 產生器 + 列印增強(合併列印為 P1) | ⭐ 有一手依據 | 31 | 6 | `4` `27` `40` `42` `53` `138` `149` | — | [R1/print-merge.md](R1/print-merge.md) |
| [G-2] 公開表單 | ⭐ 有一手依據 | 24 | 0 | `23` `32` `54` `110` `195` | Airtable · Baserow · ClamAV · OWASP | [R1/public-form.md](R1/public-form.md) |
| [R1·H-4] 記錄修改紀錄(誰、什麼時候、把什麼改成什麼) | ⭐ 有一手依據 | 0 | 7 | `81` | — | [R1/record-revisions.md](R1/record-revisions.md) |
| [H-2] 資源回收桶 + 保留期硬刪 | ⭐⭐ 深且推翻過 | 25 | 0 | `115` `124` | Airtable · Baserow · EDPB · GDPR · NocoDB · Notion · Salesforce · Teable | [R1/recycle-bin.md](R1/recycle-bin.md) |
| [R1·A-1] 設定中心(S22) | ⭐ 有一手依據 | 0 | 16 | `3` | ASVS · Airtable · Better Auth · CVE-2026-53514 · Fastify · NestJS · Notion · OWASP · Odoo · Salesforce | [R1/settings-center.md](R1/settings-center.md) |
| [F-1] 分組 / 看板 / 行事曆檢視 | ⭐⭐ 深且推翻過 | 43 | 1 | `9` `92` | Airtable · Baserow · Glide Data Grid · NocoDB · Notion · Salesforce · Teable | [R1/views-group-kanban-calendar.md](R1/views-group-kanban-calendar.md) |
| [G-1] 事件匯流排 + 出站 Webhook + API 金鑰 | ⭐⭐ 深且推翻過 | 23 | 0 | — | Airtable · CVE-2025-6454 · CVE-2026-27826 · CVE-2026-54353 · Fastify · NestJS · Notion · OWASP · Shopify · Stripe | [R1/webhook-and-events.md](R1/webhook-and-events.md) |
| [R1·UP-1] 工作區 IA(分類目錄首頁 + app-shell) | ⭐⭐ 深且推翻過 | 14 | 2 | `12` `17` `71` `90` `100` `119` | Airtable · NocoDB · Notion · SAP · Smartsheet | [R1/workspace-ia.md](R1/workspace-ia.md) |

## B. 其餘模組(引用較零星,承重前請自行複核)

| 模組 | 已出貨 | 研究強度 | 出處連結 | Ragic doc | 文件 |
|---|---|---|---|---|---|
| 「宣稱 vs 使用者走得到的路徑」稽核(全 35 份) | — | ⭐ 有一手依據 | 0 | — | [_audit/claim-vs-reality-audit-D.md](_audit/claim-vs-reality-audit-D.md) |
| 稽核「**修補本身**」(audit-D 之後的 63 檔) | — | — | 0 | — | [_audit/fix-batch-audit-E.md](_audit/fix-batch-audit-E.md) |
| 「站在巨人的肩膀」稽核（第 A 批:連 §0 標題都沒有的 14 份) | — | ⭐ 有一手依據 | 0 | `4` `11` `21` `32` `37` `121` `149` `306` | [_audit/giants-shoulders-audit-A.md](_audit/giants-shoulders-audit-A.md) |
| giants-shoulders-audit-B.md —— 已具 §0 研究節之 18 份模組文件稽核 | — | ⭐ 有一手依據 | 0 | `6` `27` | [_audit/giants-shoulders-audit-B.md](_audit/giants-shoulders-audit-B.md) |
| 「站在巨人的肩膀」**複查**(全 33 份) | — | ⭐ 有一手依據 | 0 | `27` `32` | [_audit/giants-shoulders-audit-C.md](_audit/giants-shoulders-audit-C.md) |
| [F-6] 平台可靠性工程(冪等性 / 資源配額 / metadata 車道 RLS 兜底 / 清理 job) | ✅ | · 零星引用 | 8 | — | [foundation/reliability.md](foundation/reliability.md) |
| [F-8] 訂閱計費(**地基預留**,非實作) | ✅ | — | 0 | — | [foundation/subscription-billing.md](foundation/subscription-billing.md) |
| [R1·C-4] 事件觸發器(建立 / 更新時自動執行) | — | ⭐ 有一手依據 | 1 | `26` `29` `98` `125` `163` `173` `183` `185` `214` `260` `281` | [R1/event-triggers.md](R1/event-triggers.md) |
| [R1·A11Y] 欄位輸入的無障礙名稱 | ✅ | — | 0 | — | [R1/field-label-a11y.md](R1/field-label-a11y.md) |
| [P0-1] 表單引擎動態 schema 核心 | ✅ | — | 0 | — | [R1/form-engine-core.md](R1/form-engine-core.md) |
| [R1·B-2] 表單範本庫 | ✅ | · 零星引用 | 0 | `37` `111` `176` `204` `268` | [R1/form-templates.md](R1/form-templates.md) |
| [R1·H-3] 跨表全文搜尋 | ✅ | — | 0 | — | [R1/full-text-search.md](R1/full-text-search.md) |
| [R1·H-5] 介面語言與**租戶自助翻譯** | — | ⭐ 有一手依據 | 0 | `56` `84` | [R1/i18n.md](R1/i18n.md) |
| [R1·workbench-uplift] 記錄工作台收斂(集合視圖 → Object Page) | ✅ | · 零星引用 | 7 | — | [R1/record-workbench-ui.md](R1/record-workbench-ui.md) |
| [R1·後續-2b] 伺服器端 PDF 與列印範本 | ✅ | · 零星引用 | 0 | `42` `56` `138` `284` | [R1/server-pdf.md](R1/server-pdf.md) |
| [R1·UP-2] 視圖系統 + 集合(browse)視圖 | ✅ | · 零星引用 | 0 | `4` `15` `19` `38` `54` | [R1/views-list.md](R1/views-list.md) |
| [R1·A-2] 白牌:自訂網域 + 品牌客製 | — | ⭐ 有一手依據 | 2 | `56` | [R1/white-label.md](R1/white-label.md) |
| [R2 命門] 語意計算綁定層(自由表單 ↔ 算) | — | — | 0 | — | [R2/calc-binding-layer.md](R2/calc-binding-layer.md) |

## C. 反向索引|哪一份 Ragic 官方文件已經被讀過

**要查某一份文件之前先看這裡。** 已有人逐字抄過就不必重讀。

| Ragic doc | 已被這些模組引用 |
|---|---|
| `doc/0` | [R1/authz-resource-inheritance.md](R1/authz-resource-inheritance.md) |
| `doc/3` | [R1/settings-center.md](R1/settings-center.md) |
| `doc/4` | [_audit/giants-shoulders-audit-A.md](_audit/giants-shoulders-audit-A.md) · [R1/print-merge.md](R1/print-merge.md) · [R1/views-list.md](R1/views-list.md) |
| `doc/5` | [R1/notifications.md](R1/notifications.md) |
| `doc/6` | [_audit/giants-shoulders-audit-B.md](_audit/giants-shoulders-audit-B.md) · [R1/conditional-format.md](R1/conditional-format.md) · [R1/option-colors.md](R1/option-colors.md) |
| `doc/7` | [R1/pivot-and-charts.md](R1/pivot-and-charts.md) |
| `doc/9` | [R1/pivot-and-charts.md](R1/pivot-and-charts.md) · [R1/views-group-kanban-calendar.md](R1/views-group-kanban-calendar.md) |
| `doc/11` | [_audit/giants-shoulders-audit-A.md](_audit/giants-shoulders-audit-A.md) · [R1/authz-resource-inheritance.md](R1/authz-resource-inheritance.md) |
| `doc/12` | [R1/notifications.md](R1/notifications.md) · [R1/workspace-ia.md](R1/workspace-ia.md) |
| `doc/13` | [R1/actions-approval.md](R1/actions-approval.md) · [R1/approval-advanced.md](R1/approval-advanced.md) |
| `doc/14` | [R1/field-types-parity.md](R1/field-types-parity.md) · [R1/link-picker-and-load.md](R1/link-picker-and-load.md) |
| `doc/15` | [R1/actions-approval.md](R1/actions-approval.md) · [R1/approval-advanced.md](R1/approval-advanced.md) · [R1/image-signature-fields.md](R1/image-signature-fields.md) · [R1/views-list.md](R1/views-list.md) |
| `doc/17` | [R1/workspace-ia.md](R1/workspace-ia.md) |
| `doc/19` | [R1/views-list.md](R1/views-list.md) |
| `doc/20` | [R1/field-types-parity.md](R1/field-types-parity.md) |
| `doc/21` | [_audit/giants-shoulders-audit-A.md](_audit/giants-shoulders-audit-A.md) · [R1/form-designer-2d.md](R1/form-designer-2d.md) · [R1/form-designer-ui.md](R1/form-designer-ui.md) · [R1/form-designer-wysiwyg.md](R1/form-designer-wysiwyg.md) |
| `doc/22` | [R1/pivot-and-charts.md](R1/pivot-and-charts.md) |
| `doc/23` | [R1/public-form.md](R1/public-form.md) |
| `doc/25` | [R1/field-types-parity.md](R1/field-types-parity.md) |
| `doc/26` | [R1/event-triggers.md](R1/event-triggers.md) · [R1/form-designer-wysiwyg.md](R1/form-designer-wysiwyg.md) |
| `doc/27` | [_audit/giants-shoulders-audit-B.md](_audit/giants-shoulders-audit-B.md) · [_audit/giants-shoulders-audit-C.md](_audit/giants-shoulders-audit-C.md) · [R1/field-types-parity.md](R1/field-types-parity.md) · [R1/image-signature-fields.md](R1/image-signature-fields.md) · [R1/option-colors.md](R1/option-colors.md) · [R1/pivot-and-charts.md](R1/pivot-and-charts.md) · [R1/print-merge.md](R1/print-merge.md) |
| `doc/29` | [R1/event-triggers.md](R1/event-triggers.md) |
| `doc/31` | [R1/field-types-parity.md](R1/field-types-parity.md) |
| `doc/32` | [_audit/giants-shoulders-audit-A.md](_audit/giants-shoulders-audit-A.md) · [_audit/giants-shoulders-audit-C.md](_audit/giants-shoulders-audit-C.md) · [R1/authz-resource-inheritance.md](R1/authz-resource-inheritance.md) · [R1/authz.md](R1/authz.md) · [R1/dynamic-permissions.md](R1/dynamic-permissions.md) · [R1/notifications.md](R1/notifications.md) · [R1/pivot-and-charts.md](R1/pivot-and-charts.md) · [R1/public-form.md](R1/public-form.md) |
| `doc/34` | [R1/form-designer-wysiwyg.md](R1/form-designer-wysiwyg.md) |
| `doc/35` | [R1/form-designer-2d.md](R1/form-designer-2d.md) · [R1/form-designer-wysiwyg.md](R1/form-designer-wysiwyg.md) |
| `doc/37` | [_audit/giants-shoulders-audit-A.md](_audit/giants-shoulders-audit-A.md) · [R1/form-designer-ui.md](R1/form-designer-ui.md) · [R1/form-designer-wysiwyg.md](R1/form-designer-wysiwyg.md) · [R1/form-templates.md](R1/form-templates.md) |
| `doc/38` | [R1/form-designer-wysiwyg.md](R1/form-designer-wysiwyg.md) · [R1/views-list.md](R1/views-list.md) |
| `doc/40` | [R1/print-merge.md](R1/print-merge.md) |
| `doc/41` | [R1/grid-and-excel-import.md](R1/grid-and-excel-import.md) · [R1/import-to-existing-form.md](R1/import-to-existing-form.md) |
| `doc/42` | [R1/pivot-and-charts.md](R1/pivot-and-charts.md) · [R1/print-merge.md](R1/print-merge.md) · [R1/server-pdf.md](R1/server-pdf.md) |
| `doc/51` | [R1/date-and-display-format.md](R1/date-and-display-format.md) |
| `doc/53` | [R1/form-designer-wysiwyg.md](R1/form-designer-wysiwyg.md) · [R1/print-merge.md](R1/print-merge.md) |
| `doc/54` | [R1/dynamic-permissions.md](R1/dynamic-permissions.md) · [R1/grid-and-excel-import.md](R1/grid-and-excel-import.md) · [R1/public-form.md](R1/public-form.md) · [R1/views-list.md](R1/views-list.md) |
| `doc/56` | [R1/i18n.md](R1/i18n.md) · [R1/server-pdf.md](R1/server-pdf.md) · [R1/white-label.md](R1/white-label.md) |
| `doc/58` | [R1/pivot-and-charts.md](R1/pivot-and-charts.md) |
| `doc/64` | [R1/authz.md](R1/authz.md) |
| `doc/65` | [R1/grid-and-excel-import.md](R1/grid-and-excel-import.md) · [R1/import-to-existing-form.md](R1/import-to-existing-form.md) |
| `doc/68` | [R1/actions-approval.md](R1/actions-approval.md) |
| `doc/71` | [R1/workspace-ia.md](R1/workspace-ia.md) |
| `doc/72` | [R1/form-designer-ui.md](R1/form-designer-ui.md) |
| `doc/78` | [R1/notifications.md](R1/notifications.md) |
| `doc/81` | [R1/import-to-existing-form.md](R1/import-to-existing-form.md) · [R1/record-revisions.md](R1/record-revisions.md) |
| `doc/84` | [R1/i18n.md](R1/i18n.md) |
| `doc/86` | [R1/pivot-and-charts.md](R1/pivot-and-charts.md) |
| `doc/90` | [R1/pivot-and-charts.md](R1/pivot-and-charts.md) · [R1/workspace-ia.md](R1/workspace-ia.md) |
| `doc/91` | [R1/import-to-existing-form.md](R1/import-to-existing-form.md) |
| `doc/92` | [R1/views-group-kanban-calendar.md](R1/views-group-kanban-calendar.md) |
| `doc/94` | [R1/notifications.md](R1/notifications.md) |
| `doc/96` | [R1/notifications.md](R1/notifications.md) |
| `doc/98` | [R1/event-triggers.md](R1/event-triggers.md) |
| `doc/99` | [R1/pivot-and-charts.md](R1/pivot-and-charts.md) |
| `doc/100` | [R1/workspace-ia.md](R1/workspace-ia.md) |
| `doc/107` | [R1/grid-paste.md](R1/grid-paste.md) |
| `doc/110` | [R1/public-form.md](R1/public-form.md) |
| `doc/111` | [R1/form-templates.md](R1/form-templates.md) |
| `doc/115` | [R1/recycle-bin.md](R1/recycle-bin.md) |
| `doc/119` | [R1/workspace-ia.md](R1/workspace-ia.md) |
| `doc/121` | [_audit/giants-shoulders-audit-A.md](_audit/giants-shoulders-audit-A.md) · [R1/form-designer-2d.md](R1/form-designer-2d.md) · [R1/form-designer-wysiwyg.md](R1/form-designer-wysiwyg.md) |
| `doc/122` | [R1/pivot-and-charts.md](R1/pivot-and-charts.md) |
| `doc/124` | [R1/recycle-bin.md](R1/recycle-bin.md) |
| `doc/125` | [R1/event-triggers.md](R1/event-triggers.md) |
| `doc/137` | [R1/pivot-and-charts.md](R1/pivot-and-charts.md) |
| `doc/138` | [R1/print-merge.md](R1/print-merge.md) · [R1/server-pdf.md](R1/server-pdf.md) |
| `doc/139` | [R1/grid-paste.md](R1/grid-paste.md) |
| `doc/143` | [R1/form-designer-ui.md](R1/form-designer-ui.md) |
| `doc/145` | [R1/field-types-parity.md](R1/field-types-parity.md) |
| `doc/148` | [foundation/image-processing.md](foundation/image-processing.md) |
| `doc/149` | [_audit/giants-shoulders-audit-A.md](_audit/giants-shoulders-audit-A.md) · [R1/print-merge.md](R1/print-merge.md) |
| `doc/153` | [R1/field-types-parity.md](R1/field-types-parity.md) |
| `doc/163` | [R1/event-triggers.md](R1/event-triggers.md) |
| `doc/167` | [R1/form-designer-ui.md](R1/form-designer-ui.md) |
| `doc/173` | [R1/event-triggers.md](R1/event-triggers.md) |
| `doc/176` | [R1/form-templates.md](R1/form-templates.md) |
| `doc/183` | [R1/event-triggers.md](R1/event-triggers.md) |
| `doc/185` | [R1/event-triggers.md](R1/event-triggers.md) |
| `doc/195` | [R1/public-form.md](R1/public-form.md) |
| `doc/204` | [R1/form-templates.md](R1/form-templates.md) |
| `doc/210` | [R1/grid-paste.md](R1/grid-paste.md) |
| `doc/214` | [R1/event-triggers.md](R1/event-triggers.md) |
| `doc/232` | [R1/import-to-existing-form.md](R1/import-to-existing-form.md) |
| `doc/260` | [R1/event-triggers.md](R1/event-triggers.md) |
| `doc/268` | [R1/form-templates.md](R1/form-templates.md) |
| `doc/281` | [R1/event-triggers.md](R1/event-triggers.md) |
| `doc/284` | [R1/server-pdf.md](R1/server-pdf.md) |
| `doc/286` | [R1/form-designer-ui.md](R1/form-designer-ui.md) |
| `doc/295` | [R1/field-types-parity.md](R1/field-types-parity.md) |
| `doc/306` | [_audit/giants-shoulders-audit-A.md](_audit/giants-shoulders-audit-A.md) · [R1/form-designer-2d.md](R1/form-designer-2d.md) · [R1/form-designer-wysiwyg.md](R1/form-designer-wysiwyg.md) |
| `doc/344` | [R1/field-types-parity.md](R1/field-types-parity.md) |
| `doc/357` | [R1/field-types-parity.md](R1/field-types-parity.md) |
