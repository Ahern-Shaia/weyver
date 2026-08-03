# 開源 MES 生態技術與功能拆解

> **文件性質**|T 模組(MES)之「站在巨人的肩膀上」研究產出。對照 `docs/16`(OSS 表單引擎技術拆解)之於 R1 表單引擎的地位 —— `docs/08` 是**商用 MES 市場分析**(誰在賣、賣多少錢),本文件是**開源 MES 生態的技術與授權拆解**(什麼能用、什麼只能看、什麼該自建)。
> **研究方法**|2026-08-03 六個 agent 平行深挖官方文件 + repo LICENSE 檔 + 標準原文;**所有承重的授權宣稱由本專案逐一複驗**(`gh api` 取回 LICENSE 檔逐字,非採信轉述)。
> **配套**|`docs/08`(MES 市場)· `docs/04 §T`(T 模組 22 人月)· `docs/11 §5·§16`(Edge Gateway 技術棧)· `docs/14`(前端設計規則)· `docs/24`(用戶心智模型)· `docs/20`(領域引擎 build-on)。
> **版本**|2026-08-03 v1

---

## 0. TL;DR|六個決定性結論

1. **開源 MES 圈的授權形狀極度不利**|功能最完整的 **qcadoo 是 AGPL-3.0(不可讀碼)**,而授權最乾淨、可 fork 的 **UMH 根本不是 MES**(官方自述只做 data management)。**不存在「抄一套開源 MES 就好」的路徑。**

2. **但也因此,向上設計的位置是可稽核的**|開源 MES 圈**沒有任何一個**提供終端使用者自助的表單/流程設計器。qcadoo 官方文件逐字要求加功能得跑 `mvn archetype:generate` 寫 XML + Java 重編譯。這是強度等同 AGENTS.md 中 Ragic JS workflow 引文的一手依據。
   ⚠️ **但不得宣稱「no-code MES 沒人做」** —— Tulip(專有)已是成熟的 no-code MES。可成立的敘述僅限「**開源** MES 圈裡沒有」。

3. **🔴 EMQX 已轉 BSL 1.1,且明文排除 Weyver 的用法** —— 推翻 `docs/11` 既有選型,替代方案為 NanoMQ(MIT)/ Mosquitto(BSD 分支)。詳 §4.1。

4. **功能矩陣的座標軸應由 MESA-11 換成 ISA-95 Part 3 的 4 domain × 8 activity** —— 不只因為它更嚴謹,而是因為**「同一組活動語意套用在四個 domain」與 Weyver「表單引擎為 substrate、各領域是引擎上的表單 app」在結構上同構**。詳 §2。

5. **B2MML 是免費合法取得 ISA-95 物件模型的路徑** —— ISA-95 Part 2/4 標準本文付費,但 B2MML 的 XSD 把物件與屬性全部具體化並公開,授權為 permissive + 姓名標示。**不必買標準。** 詳 §2.6。

6. **APS 排程是唯一必須破壞「統一 TypeScript 全棧」的地方** —— 經實測,npm 上不存在可用的 CP-SAT binding。此事**需獨立 M0 裁定**,不得默默塞進 T 模組。詳 §6.1。

---

## 1. 授權地圖(clean-room 判定|查證日 2026-08-03)

> 依 `AGENTS.md §5-bis`:**規則同時管「讀」,不只管「fork」**。MIT / Apache-2.0 / MPL / EPL / BSD 可 fork 可讀實作;GPL / AGPL / 非 OSS 一律**只讀公開文件**;無 LICENSE 檔者**保留所有權利,完全不可用**。

### 1.1 ✅ 可 fork、可讀實作

| 專案 | SPDX | 複驗方式 | 對 T 模組的用處 |
|---|---|---|---|
| **United Manufacturing Hub** | `Apache-2.0` | `gh api repos/united-manufacturing-hub/united-manufacturing-hub` | UNS topic 設計、OEE 演算法、Edge 單容器模式 |
| **benthos-umh** | `Apache-2.0` | 同上 repo | 邊緣 ETL(內建 OPC UA / Sparkplug / S7 input) |
| **AMRC Factory+ / ACS** | `MIT` | `gh api repos/AMRC-FactoryPlus/amrc-connectivity-stack` | Sparkplug B + schema 治理 + 邊緣部署 |
| **ktg-mes(苦糖果)** | `MIT` | `gh api repos/sparklefire/ktg-mes` | **離散製造中文業務語意最完整的可讀來源** |
| **frePPLe** | `MIT`(dual) | `COPYING` 逐字「dual licensing … free of charge under the **MIT License**」 | R2 MRP / APS 演算法藍圖 |
| **Google OR-Tools** | `Apache-2.0` | `gh api repos/google/or-tools` | CP-SAT 排程求解器(§6.1) |
| **Timefold Solver**(Community) | `Apache-2.0` | `gh api repos/TimefoldAI/timefold-solver` | ⚠️ 多執行緒屬專有版,見 §6.1 |
| **Apache OFBiz** | `Apache-2.0` | GitHub API | ERP 側製造實體關係設計的**唯一**可讀來源 |
| **FUXA** | `MIT` | `gh api repos/frangoteam/FUXA` | ⚠️ Angular,元件不可復用;價值在證明「純 GUI 建工廠畫面」可行 |
| **Rapid SCADA**(Standard) | `Apache-2.0` | `gh api repos/RapidScada/scada-v6` | .NET,非 Weyver 生態 |
| **node-opcua** | `MIT` | `gh api repos/node-opcua/node-opcua` | ⭐ TypeScript 原生 OPC UA,與 Weyver 同棧 |
| **open62541** | `MPL-2.0` | GitHub API | 檔案級 copyleft,可嵌入;OPC Foundation 認證 |
| **Apache PLC4X** | `Apache-2.0` | GitHub API | Modbus / S7 / EtherNet-IP driver |
| **NanoMQ** | `MIT` | `gh api repos/nanomq/nanomq` | ⭐ **斷網 store-and-forward 的解**(§4.2) |
| **Mosquitto** | `EPL-2.0 OR BSD-3-Clause` | `LICENSE.txt` 逐字含 `SPDX-License-Identifier` | 走 BSD 分支嵌入最乾淨 |
| **Bento**(benthos fork) | `MIT` | `LICENSE` 檔為 MIT 全文 | Redpanda Connect 的乾淨替代 |
| **Telegraf** | `MIT` | GitHub API | 指標採集 |
| **MTConnect cppagent** | `Apache-2.0` | GitHub API | CNC / 工具機(食品業可能用不到) |
| **Node-RED** | `Apache-2.0` | `gh api repos/node-red/node-red` | 見 §4.3 的定位風險 |
| **Eclipse BaSyx** | `MIT` | GitHub API | AAS 資產建模;台灣食品業無此合規壓力 → R4 觀察 |
| **B2MML** | permissive + 姓名標示 | `LICENSE` 逐字(§2.6) | ⭐ **免費取得 ISA-95 物件模型** |

### 1.2 ❌ 只讀公開文件(不得讀原始碼)

| 專案 | SPDX | 複驗 | 備註 |
|---|---|---|---|
| **qcadoo MES** | `AGPL-3.0-or-later` | `LICENSE.txt` 逐字「GNU **Affero** General Public License … version 3」 | ⚠️ GitHub API 回 `NOASSERTION`,偵測不出 |
| **OpenMes**(Mes-Open) | `AGPL-3.0` | GitHub API | PHP / Laravel |
| **iPlusMES** | `GPL-3.0` | GitHub API | 架構理念最接近 Weyver,但 WPF 桌面 |
| **万界星空 free-mes** | `GPL-3.0` | GitHub API | ⚠️ 行銷文宣稱 Apache-2.0,**與 repo 不符** |
| **Odoo Community** | `LGPL-3.0` | `LICENSE` 逐字「GNU LESSER GENERAL PUBLIC LICENSE, Version 3」 | ⚠️ GitHub API 回 `NOASSERTION` |
| Odoo Enterprise | 專有 | repo 非公開 | Studio / Shop Floor / MPS / Quality / PLM 皆在此 |
| **ERPNext** | `GPL-3.0` | `license.txt` | 資料模型文件品質最佳,可讀**文件** |
| **iDempiere** | `GPL-2.0` | `LICENSE.md` | Application Dictionary 值得學,見 §8 反面警示 |
| **metasfresh** | `GPL-2.0` | `LICENSE.md` | 食品業血統,功能對照價值高 |
| **Tryton** | `GPL-3.0-or-later` | `COPYRIGHT` | 模組邊界拆法值得參考 |
| **Dolibarr** | `GPL-3.0` | GitHub API | 無工序層,非 MES 對照基準 |
| **Axelor Open Suite** | `AGPL-3.0` | `LICENSE` | 製造功能模型最完整的免費**文件**來源 |
| **Grafana** | `AGPL-3.0` | `gh api repos/grafana/grafana` | 🔴 自 v8.0(2021-04-20)起,非 Apache-2.0 |
| **Scada-LTS** | `GPL-2.0` | GitHub API | |
| **OpenPLC Editor** | `GPL-3.0` | `Autonomy-Logic/openplc-editor` | 舊 `thiagoralves/*` 已 archived |
| **Grash / Atlas CMMS** | `AGPL-3.0` | GitHub API | ⚠️ TypeScript,技術棧相近**更該避免閱讀** |
| **openMAINT** | `AGPL-3.0` | 官方授權頁 | 另要求 UI 保留 logo 與外連,與白牌需求直接衝突 |
| **Redpanda Connect** | `Apache-2.0` + `RCL` 雙軌 | `licenses/README.md` | 不可直接用,改用 Bento / benthos-umh |
| **Ignition** | 專有 | 官方授權頁 | 僅作現場 UI 設計基準 |

### 1.3 ⛔ 完全不可用

| 專案 | 狀況 |
|---|---|
| **LiteMES** | `gh api` 回 `license: null` —— **無授權檔 = 保留所有權利** |
| **ScadaBR** | 同上,且最後 push 2023-02 |
| **🔴 EMQX v5.9.0+** | `BSL 1.1`,Additional Use Grant **明文排除 embedded**(§4.1) |

### 1.4 ⚠️ 授權漂移警示(本輪實際抓到四起)

**「授權會變」不是形式主義,本輪一次研究就抓到四個案例:**

| 案例 | 漂移方向 | 若沿用舊印象的後果 |
|---|---|---|
| **UMH** | AGPLv3 → **Apache-2.0**(2023-03) | 誤判為不可用,**白白放棄可 fork 的資產** |
| **EMQX** | Apache-2.0 → **BSL 1.1**(v5.9.0) | **誤以為可自由嵌入出貨 → 授權違規** |
| **Grafana** | Apache-2.0 → **AGPL-3.0**(v8.0) | 誤讀原始碼 → clean-room 污染 |
| **万界星空** | 行銷文稱 Apache-2.0,repo 實為 `GPL-3.0` | **以廠商文案為據 = 直接違規** |

**推論(建議寫入 `AGENTS.md`)**|
1. **GitHub License API 不可作為唯一依據** —— qcadoo(AGPL)與 Odoo(LGPL)皆回 `NOASSERTION`,frePPLe(MIT)亦然。**必須讀 LICENSE 檔本文。**
2. **廠商行銷頁不可作為授權依據** —— 只有 repo 內的 LICENSE 檔算數。
3. **同一家公司的不同產品授權可以不同** —— EMQ 的旗艦 EMQX 轉 BSL,邊緣產品 NanoMQ 仍 MIT。

---

## 2. 功能矩陣的座標軸|建議由 MESA-11 換成 ISA-95 Part 3

### 2.1 為什麼要換

`docs/08 §1.1` 目前以 **MESA-11 扁平清單**為功能對照軸。該清單仍然有效,但作為**矩陣座標軸**有兩個弱點:條目之間不正交(「製程管理」與「派工」重疊)、且無法表達「同一件事在不同領域重複發生」。

### 2.2 ISA-95 Part 3 的 4 × 8 正交模型(一手逐字)

ISA-95 Part 3 標準本文付費,但 **ISO 22400-2:2014 的免費 preview 逐字複述了該分類**,構成一手交叉佐證:

> "MOM, sometimes referred to as manufacturing execution systems (MES), models **four major categories of operations management**:
> — production operations management; — maintenance operations management; — quality operations management; — inventory operations management.
> An activity model further details each category. **Each activity model includes eight activities**:
> — detailed scheduling; — dispatching; — execution management; — resource management; — definition management; — tracking; — data collection; — analysis."

**這 4 × 8 = 32 格為什麼適合 Weyver**|「同一組活動語意(排程 / 派工 / 執行 / 資源 / 定義 / 追蹤 / 採集 / 分析)套用在四個領域(生產 / 維護 / 品質 / 庫存)」——**這正是「一個 substrate 承載多個領域表單 app」的架構主張在標準層的鏡像**。ISA-95 用 32 格說的事,Weyver 用「同一個表單引擎 × 四類表單」說。

**術語校正**|標準原文為 **execution management**(非 execution)、**analysis**(非 performance analysis;後者是 MESA-11 用語)。二手文章常混用兩套術語。

### 2.3 MESA-11 補 Document Control —— 且它是「MES + ISO 織入」的一手依據

ISA-95 Part 3 的八活動**沒有文件管制**。MESA White Paper #6(1997)的 Appendix A 逐字定義:

> **Document Control** — "Controls records/forms that must be maintained with the production unit, including work instructions, recipes, drawings, standard operation procedures, part programs, batch records, engineering change notices, shift-to-shift communication... It would also include the control and integrity of environmental, health and safety regulations, and **ISO information such as Corrective Action procedures**."

**這一條把 ISO 文管與 CAPA 明文歸進 MES 功能表。** Weyver「MES + ISO 織在同一 substrate」不是自創的組合,而是 MESA 1997 年就寫在功能定義裡的東西 —— 這是對外論述可引用的一手依據。

### 2.4 VDI 5600 補「管理對象」次軸

VDI 5600 Blatt 1(現行版 2016-10)依**管理對象**分組,其中 **Material management** 與 **Personnel management** 在 ISA-95 Part 3 中沒有獨立成軸(被塞在各領域的 resource management 裡)。做功能矩陣時以 ISA-95 為主軸、VDI 補次軸,覆蓋最完整。
⚠️ VDI 指引付費,八項任務清單為**二手**(多來源一致但未取得原文逐字),不得作承重依據。

### 2.5 ISO 22400 元素表 = 資料收集完整性的檢核軸

ISO 22400-2 的 KPI 公式在付費的 Clause 6,但**符號表(clause 3)在免費 preview 內**,而它實際上就是「現場必須採集哪些時間戳與數量」的清單:
`PBT` · `APT` · `AUBT` · `AUPT` · `AUST` · `ADOT` · `ADET` · `AOET` · `POET` · `APAT` · `APWT` · `PQ` · `GQ` · `POQ` · `OEE` · `NEE` · `Cp`/`Cpk`/`Cm`/`Cmk` · `MTBF`/`MTTR`。

**這張表比 KPI 清單本身更有用**|只要現場表單能產出這些元素,所有 KPI 都是衍生計算,**不需要為每個 KPI 建一張表**。這與「表單存記錄、計算層做推導」的分層一致。

### 2.6 ⭐ B2MML|免費合法取得 ISA-95 物件模型

ISA-95 Part 2 / Part 4(物件與屬性)標準本文付費,但 MESA 維護的 **B2MML** 把資料模型實作成公開 XSD。LICENSE 檔逐字複驗:

> "Permission to use, copy, modify, or redistribute this Work and its documentation, with or without modification, for any purpose and **without fee or royalty** is hereby granted provided MESA International is acknowledged as the originator of this Work using the following statement:
> **"The Business To Manufacturing Markup Language (B2MML) is used courtesy of MESA International.""**

**實務結論**|與其購買標準,不如直接讀 B2MML 的 XSD 反推欄位清單,設計成 Weyver 的預建表單範本。**使用時必須保留上述 attribution 聲明**,並記入 clean-room log。
(repo `MESAInternational/B2MML-BatchML`,V0700,最後 push 2023-08,131★;GitHub API 回 `NOASSERTION`,故以 LICENSE 檔為準。)

### 2.7 ⚠️ 常見誤傳更正

**「c-MES 把 MESA-11 壓成 8 項」是錯的。** MESA 官網的模型沿革頁描述 c-MES(2004)為 "shifted focus to show how core operations activities interact with business operations",**從未宣告刪除功能**。坊間的「8 項」實為 **VDI 5600 的分組**,兩者被混為一談。若寫進 Weyver 文件會是承重錯誤。

**MESA 模型四代**|MESA-11(1996)→ c-MES(2004)→ Strategic Initiatives Model(2008)→ Smart Manufacturing Model(2022)。**後兩代已非功能清單型模型**,不適合當對照矩陣的軸 —— MESA-11 至今仍是唯一可用於此目的的 MESA 產物。

---

## 3. 開源 MES 專案拆解

### 3.1 專門 MES / MOM

| 專案 | 授權 | 技術棧 | 活躍度 | 定位 |
|---|---|---|---|---|
| **qcadoo MES** | `AGPL-3.0` | Java + Spring + PG | 926★,2026-07-31 | **功能最完整的開源 MES**,但不可讀碼 |
| **ktg-mes** | `MIT` | RuoYi + SpringBoot + Vue2 + MySQL | Gitee 6,022★ | **唯一可讀碼的完整離散製造 MES** |
| **iPlusMES** | `GPL-3.0` | C# / .NET + WPF/MAUI | 23★,活躍 | ISA-88 導向,架構理念最近但綁桌面 |
| **万界星空** | `GPL-3.0` | SpringBoot2 + Vue3 | 377★ | 開源版明文停止支援 |
| **OpenMes** | `AGPL-3.0` | Laravel + PG | 80★,很新 | |
| **LiteMES** | 無授權 | — | — | ⛔ 不可用 |

**qcadoo 的商業分層**|Gantt 拖拉、maintenance 模組、REST API、ERP 整合皆在商業版 —— 社群版是引流版。此模式在中文圈開源 MES 更極端(万界星空逐字:「開源版不再提供演示、不提供技術支持與問題解答」「商業版與開源版完全不是一個平台」)。

### 3.2 ⚠️ UMH 與 Factory+ 不是 MES

兩者常被歸類為開源 MES,但官方自述並非如此:
- **Factory+**|"an open and modular framework aimed at simplifying and standardising **data management**",明示不取代 OPC UA 而是補充。
- **UMH**|文件涵蓋範圍僅「data extraction, contextualization, standardization, exchange, storage, and visualization」。

**兩者在 MESA-11 上只有第 5 項(資料收集)與第 11 項(效能分析)有實質內容** —— 無排程、無派工、無工藝 / BOM。**把 UMH 當 MES 用會落空。**

### 3.3 ERP 內建製造模組|唯一有像樣 MES 執行層的是 Odoo Enterprise(專有)

| 專案 | 現場終端 | 機台連線 | OEE |
|---|---|---|---|
| **Odoo Enterprise** | ✅ Shop Floor kiosk | ✅ IoT Box | ✅ |
| Odoo Community | ❌ | `iot_base` 在 repo,可用性未查證 | 未查證 |
| ERPNext | Job Card 為 web 表單 | ❌ | ❌ |
| 其餘六家 | ❌ 未查證到現場終端 | ❌ | ❌ |

**本專案複驗**|`gh api repos/odoo/odoo/contents/addons` 確認 `web_studio`、`mrp_workorder`(Shop Floor)、`mrp_mps`、`quality*`、`plm*` **均不在 Community**;反之 `iot_base` / `iot_drivers` / `maintenance` / `mrp_subcontracting`(6 個子模組)**確實在** Community —— 後者推翻了多篇二手部落格。

**→ 整個開源 ERP 世界只有 Odoo Enterprise 有像樣的 MES 執行層,而它是付費專有的。這是 Weyver「ERP + MES 一體」的明確市場空位。**

### 3.4 值得借鏡的資料模型切法(僅讀公開文件)

| 來源 | 借鏡點 |
|---|---|
| **iDempiere `PP_Product_Planning`** | 把 MRP 訂購政策(Order Policy / Order Period / Min Qty)**從 BOM 抽離成獨立實體** → R2 MRP 直接可用 |
| **iDempiere `PP_Cost_Collector`** | 報工 / 耗料 / 機時 / 良不良走**單一實體**,成本結轉回財會的樞紐 |
| **metasfresh BOM 驗證** | BOM 須先 verify,檢查**循環依賴** → 應為 Weyver 引擎級內建檢查 |
| **ERPNext BOM 送出後不可改** | 改需 cancel → duplicate → resubmit,保護已連結單據 → 與傳票不可變鐵則同源 |
| **Tryton production 模組群** | routing / work / split / outsourcing 各自獨立模組 → 與「表單 app 疊加」哲學相符 |
| **OFBiz routing sequence** | 序號用 **10 的倍數**,方便日後插入中間工序 |

---

## 4. Edge Gateway 選型|推翻 `docs/11` 的 EMQX 預設

### 4.1 🔴 EMQX 已不可用於 Weyver 的出貨形態

`emqx/emqx` 的 LICENSE 檔逐字(2026-08-03 複驗):

> Business Source License 1.1
> **Licensed Work:** EMQX Version 5.9.0 or later.
> **Additional Use Grant:** a. You may make production use of **a single node** of the Licensed Work, provided your use **does not include offering the Licensed Work to third parties on a hosted or embedded basis**. "Hosted or embedded basis" means providing the Licensed Work as a service or **integrating it into a product or solution offered to third parties**.
> **Change Date:** Four years from the date the Licensed Work is published.

**Weyver 的 Edge Gateway 是 per-customer 出貨、把 broker 包進交付物 —— 正好落在明文排除的範圍內。**

**`docs/11` 受影響處**|
- **line 1152 逐字寫「EMQX open-source edition(Apache 2.0)|MQTT broker」—— 此句現為錯誤**,須更正。
- 另約 8 處以 EMQX 為預設(§ 5.3、§ 16.5–16.11 成本表與架構圖)。
- **line 1326 的交叉引用「授權替代見 § 5.4」指錯地方** —— § 5.4 談的是客戶已有 Kepware / Ignition 時的對接,完全未涉及 EMQX 授權。

**⚠️ 但不需整章重寫** —— `docs/11 § 5.2` 的協定 library 清單(`node-opcua` / `modbus-serial` / `nodes7`)本就正確,§ 5.3 也已列 self-host **Aedes** 為替代並有 SQLite 本地暫存設計。**要修的是兩處具體錯誤,不是架構。**

### 4.2 替代元件(授權全數複驗)

| 需求 | 採用 | SPDX | 理由 |
|---|---|---|---|
| **斷網 store-and-forward** | **NanoMQ** | `MIT` | 原生 SQLite bridge cache(`disk_cache_size` / `flush_mem_threshold` / `resend_interval`)。⚠️ HiveMQ Edge 把 Offline Buffering 放在**付費側**,EMQX 已 BSL —— NanoMQ 是唯一 MIT 且原生支援者 |
| 通用 broker | Mosquitto | `EPL-2.0 OR BSD-3-Clause` | 走 BSD 分支嵌入最乾淨 |
| OPC UA(TS) | **node-opcua** | `MIT` | 與 Weyver 同棧;自實作 OPC UA binary protocol + security policy 是數人月且錯了是資安洞 |
| OPC UA(C 嵌入) | open62541 | `MPL-2.0` | 檔案級 copyleft,OPC Foundation 認證 |
| 工業協定 driver | Apache PLC4X | `Apache-2.0` | 純苦工,無差異化 |
| 邊緣 ETL | benthos-umh | `Apache-2.0` | 單一 Go binary,無 JVM |
| 設備上下線偵測 | Sparkplug B 規格 | `EPL-2.0` | birth/death certificate 天生解決;⚠️ Eclipse Tahu 的 master 分支已停在 2023-11,**實作規格即可,不必依賴 Tahu** |

**明確不採用**|ThingsBoard 全平台(自帶 tenant / RBAC / dashboard,與已 SHIPPED 的 F-2 Auth + P0-4a 三層權限**直接重疊且相衝**)· Eclipse Kura / Kapua(JVM + OSGi = 第二技術棧)· Eclipse Ditto(**Weyver 表單引擎本身就是狀態儲存與建模層**,引入即架構重複)· StreamPipes(微服務多容器,不適合工廠小工控機)。

**⚠️ NanoMQ 的 SQLite bridge cache 有 issue #1980 效能疑慮,且官方文件對 local client vs bridging 有限縮敘述 —— 上線前必須自行壓測,不可只憑文件。**

### 4.3 Node-RED 的定位|有一級廠商背書,但不得交到客戶手上

**production 證據(一手)**|Opto 22 groov EPIC 官網逐字「**Included in groov EPIC and groov RIO is Node-RED**」· Siemens SIMATIC IOT2050 預裝 · Hilscher netFIELD 官方 KB 有專屬文件。**不是玩具。**

**但最接近 Weyver 用例的 UMH 走離了它**,官方逐字:「**benthos offered better scalability and maintainability compared to Node-RED for our use cases**」。UMH 的解法是把 Node-RED 的易用性**移植進 Benthos**(新增 `nodered_js` processor)。

**🔴 定位風險(必須寫進 T 模組 M0)**|`AGENTS.md` 第一約束是「不用寫 code」,且明訂「**視覺化 ≠ 簡化**」——把 Node-RED 交到客戶手上,等於交給他們一個要理解執行順序、型別、例外的 flow 編輯器,**是換皮不是解決**。

**建議分層**|
- **資料平面**(高頻、要可靠)→ benthos-umh 或自寫 TS worker + NanoMQ。**客戶不碰。**
- **設備設定**(客戶要碰的)→ **表單化的 device/tag 設定頁**(選協定 → 填 IP → 掃 tag → 拖到表單欄位)。
- **Node-RED** → 保留為**工程師的逃生口**,限低頻非關鍵路徑,**不得是唯一路徑**。

### 4.4 UNS(Unified Namespace)與 Weyver substrate 的關係

**定義(UMH 官方一手)**|"a powerful **event-driven architecture** that allows for seamless communication between nodes in a network",且 "**all data, regardless of whether there is an immediate consumer, should be published and made available for consumption**"。topic 階層通常依 ISA-95:`enterprise/site/area/line/cell/tag`。
⚠️「Walker Reynolds 首創」為二手(多家一致轉述),**未取得本人原始發表逐字**。

**與 Weyver 的共鳴**|UNS 說「不要點對點,要一個語意化的單一真實來源」;Weyver 說「不要 ERP/MES/ISO 各一個 tab,要織在同一個工作區」。**UNS 是資料在動的那一層的 substrate,Weyver 表單引擎是資料靜止那一層的 substrate。** ISA-95 的 `enterprise/site/area/line/cell` 語意階層與 Weyver 的 `form_categories` 分類目錄(`docs/27` D3)可以是同一棵樹的兩種投影。

**🔴 三個必須在 T 模組 M0 裁定的衝突**|
1. **誰是 SSOT?** UNS 教條是「broker 上的 retained message 就是當前狀態」;Weyver 教條是「真實 PG 表就是當前狀態」。**兩個 SSOT = 沒有 SSOT。** 建議裁定:**UNS 是傳輸與即時視圖層,PG 是帳本層** —— 一旦碰到 R2 計算層,不可變帳本鐵則與 MQTT 的 fire-and-forget 語意根本不相容。
2. **schemaless vs metadata-driven**|高頻 tag 直接落 Tier-2 動態表會炸。建議 tag 流走時序層,**只有「事件」(工單開始 / 品檢結果 / Andon 觸發)才變成表單記錄**。
3. **"publish everything even without a consumer" 與租戶配額 / 成本鐵則直接衝突** —— Edge → Cloud 之間必須有明確的 report-by-exception 與 down-sampling 閘門,**不能把 UNS 教條原封搬上雲**。

---

## 5. 現場 UI(shopfloor)|價值在慣例,不在程式碼

### 5.1 可復用元件 = 零

授權可用者(FUXA `MIT`)是 **Angular**,與 Weyver 的 Next.js + React 不相容;技術棧相容或成熟者(Grafana `AGPL`、Ignition 專有)授權不可用。**本軸的產出應是一份 Weyver 現場 UI style guide,而非依賴清單。**

### 5.2 證據層級的誠實標注

| 文件 | 狀態 |
|---|---|
| ANSI/ISA-101.01-2015 | **付費,全文未取得**。僅得委員會 scope |
| EEMUA 191 第 4 版(2024-11) | **付費,僅取得官方目錄 PDF** |
| NAMUR NA 102 | **完全未取得,不列為依據** |
| **Rockwell PROCES-WP023《Process HMI Style Guide》** | ✅ **公開 PDF 全文**,明示依據 ANSI/ISA-101.01-2015 + ISA-18.2-2016 |

> ⚠️ 網路上「ISA-101 主張平時灰階、只有異常才用顏色」的說法幾乎全來自二手部落格,**無法從 ISA-101 原文逐字證實**。可證實的是:**一份明示實作 ISA-101 的廠商指南確實逐字這樣寫**。兩者證據層級不同。

### 5.3 色彩慣例(Rockwell WP023 逐字,一手)

> "Color is also the **most overused and abused attribute** in display design."
> "Used in a limited manner, color does have value and **should be earmarked for abnormal situations, such as alarms**."
> "**Alarms: Use bright, intense colors. Do not use these colors for anything else.**"
> "**Gradient colors should not be used.**"
> "**State depiction cannot depend on color only.** Additional features such as fill, shape, or simple text may be used."

**PlantPAx 色表(一手數值)**|背景 `#E0E0E0` · 文字 `#3F3F3F` · 設備外框 `#A0A0A4` · **即時資料(唯一常態色)藍 `#475CA7`** · Low `#916AAD` · Medium `#F5E11B` · High `#EC8629` · Urgent `#E22028` · Fault `#000000` · 停止/離線 `#808080` · **運轉中 `#F0F0F0`(近白)** · 手動 `#93C2E4`。

**兩件反直覺的事**|① **「運轉中」不是綠色而是近白** —— 綠燈代表正常是被明確拋棄的舊範式。② 報警四級是**洋紅 → 黃 → 橘 → 紅**,不是常見的藍 → 黃 → 橘 → 紅。

**與 Weyver 既有規則的關係**|「禁漸層」「禁色彩單獨承載狀態」與 `docs/14` 既有的**禁陰影 / 禁裝飾配色**同源,可直接對齊 —— 這是外部一手佐證,不是新增約束。

### 5.4 字級、觸控與報警

**字級(Rockwell 一手)**|Sans Serif、桌面典型 10pt、主要資料 11pt Bold、畫面標題 24pt Bold;並註明「a large monitor mounted **high on a wall**… may need a **larger font**」——**看板與操作台必須是兩套字階**。

**觸控目標|一手證據只有一條**|**WCAG 2.2 SC 2.5.8(Level AA)** 逐字:"The size of the target for pointer inputs is **at least 24 by 24 CSS pixels**"。
⚠️ 網傳「戴手套 12mm × 12mm」為二手部落格轉述,**未查證,不得作承重依據**。ISO 9241-410 Annex J 確有觸控尺寸規範但**數值在付費正文**。
硬事實一條(Ignition 官方)|「**gestures will only work consistently on capacitive touchscreens**」——**電阻式面板上不要設計手勢**。

**報警慣例(Rockwell 一手)**|alarm banner + **就地顯示**雙軌 · 未確認報警「blink between alarm color and **gray border**」· "**Text itself should not blink**… instead, using a **blinking border**" · 必須提供操作員**停止閃爍**的方式 · 狀態機動詞:acknowledge / suppress / disable / **shelve** / unshelve。
⚠️ 廣傳的 EEMUA 191「高 5% / 中 15% / 低 80%」分布,**數值在付費正文,未取得 → 不得寫成 Weyver 規範**。

**無權限的控制項**|"should be **disabled or 'greyed-out', but not made invisible**" —— 隱藏會讓操作員找不到而困惑。⚠️ 此點與 Weyver `docs/27` D4「隱藏疊權限之上」的裁定**方向不同**,現場 UI 與辦公室 UI 在此需分別對待,建議於 T 模組 M0 明確標示為 shopfloor 例外。

### 5.5 ⭐ Level 1–4 畫面層級 —— `docs/24` 的外部佐證

Rockwell 逐字:「**Level 2 displays are the primary displays used for operators to perform their tasks and should be designed first.**」且「Level 1 displays should be designed **secondarily to** Level 2 displays.」

**先設計操作員每天用的那一頁,總覽頁後做** —— 這與 `docs/24`「主畫面不是 KPI 儀表板」的裁定完全同向,是**外部一手佐證**。

### 5.6 對 `docs/14` 的擴充建議

1. **新增 `[data-density="shopfloor"]`,與現有 `[data-theme]` 正交** —— 現行密度參數是辦公室螢幕的,現場 kiosk 受 WCAG 24 CSS px 下限與手套操作約束。**不另建一套設計系統。**
2. **擴 semantic token 為 `alarm-low / medium / high / urgent` 四級,並強制每級搭配形狀或文字** —— 色彩不得單獨承載狀態。
3. **看板與操作台分兩套字階。**

---

## 6. 演算法三塊 + OEE

### 6.1 🔴 APS|唯一必須跨語言之處(需獨立 M0 裁定)

**OptaPlanner 已死** —— repo 已 archived,Red Hat build 於 2024-05-30 EOL,創始人 fork 為 **Timefold**。舊資料若推薦 OptaPlanner 即為過期。

**Timefold 有能力天花板**|官方逐字:「Timefold Solver Plus and Timefold Solver Enterprise are commercial products which offer additional features, such as score analysis, **nearby selection** and **multithreaded solving**」,且「**not open-source**」。**對 OSS-only 的 Weyver,等於只能單執行緒** —— 這是實質能力限制,不是授權標籤問題。

**→ 建議採 OR-Tools CP-SAT(`Apache-2.0`,無版本分層)。**

**JS/TS 原生求解器:經實測不存在。** 本專案複驗 npm registry,`or-tools` / `cp-sat` / `@google/or-tools` / `timefold` / `node-or-tools` **全數 `Not found`**。JS 生態實際維護中的只有 LP/MIP 層級(`highs` MIT、`yalps` MIT、`glpk.js` **GPL-3.0 不可鏈入**),而 **LP/MIP ≠ CP scheduling** —— job shop 要的是 interval variable 與 `AddNoOverlap` / `AddCumulative` 這類排程專用傳播器。

**待裁定事項(不得默默決定)**|引入 **Python sidecar(FastAPI + OR-Tools)** 會破壞「統一 TypeScript 全棧」的架構主張,代價是多一套部署 / 監控 / **租戶隔離面**(sidecar 亦須執行 tenant scoping,不能只靠 API gateway)。替代方案(TS 自寫 CP 求解器)在 solo 資源下不可行 —— CP-SAT 是 Google 投入十年以上的 C++ 工程,重寫是人年級不是人月級。

**概念層**|FJSP(每個 operation 可在一組候選機台擇一)為 JSP 的推廣,NP-hard;精確解實務上限約 20 jobs × 10 machines,再大靠 metaheuristic 或 CP-SAT time-limited search。⚠️「互動式重排 5–30 秒 / 夜間全域 5–30 分鐘」為業界通則**推定,非一手出處**。

### 6.2 SPC|自建,1–2 人月

**無可鏈入的 OSS**|R `qcc` 功能最全但為 GPL;JS/TS 無成熟品。**只能黑箱對拍(比數值,不讀原始碼),此事須寫進 clean-room log。**

**判異規則|Western Electric(一手,NIST/SEMATECH §6.3.2 逐字)**|"Any Point Above +3 Sigma" / "2 Out of the Last 3 Points Above +2 Sigma" / "4 Out of the Last 5 Points Above +1 Sigma" / "8 Consecutive Points on This Side of Control Line"。
**NIST 同時警告代價**|"Adding the WECO rules increases the frequency of **false alarms to about once in every 91.75 points**"(對比純 3-sigma 約 371 點)。**這條要進產品說明,否則客戶會抱怨誤報。**

**Cp/Cpk(一手,NIST §6.1.6)**|`Cp = (USL − LSL) / 6σ`;`Cpk = min[(USL − μ)/3σ, (μ − LSL)/3σ]`。
⚠️ **Nelson rules 八條的措辭為二手**(JQT 1984 原文付費牆未取得);**Pp/Ppk 的 within vs overall sigma 區分亦為二手**(ISO 22514-2 / AIAG SPC 皆付費)。實作前應購原文核對。

**TS 自建難度低**|全部是算術 + 常數表(d2/d3/c4)+ 滑動視窗規則掃描,無矩陣運算、無最佳化。風險不在數學而在**常數表與規則措辭的正確性**。

> ⚠️ **與 `docs/04` 的落差**|`docs/04 §T` 目前將 SPC 標為「**暫緩**」(對標 6 人月)。本研究評估 TS 自建為 **1–2 人月**。建議於 T 模組 M0 重新評估是否納入 MVP。

### 6.3 CMMS|長在 substrate 上,不需要巨人

openMAINT 與 Grash 皆 `AGPL-3.0` → 不可讀。**Grash 是 TypeScript 這點反而更危險** —— 技術棧相近時「讀了再寫類似的東西」正是 clean-room 要隔開的污染路徑。

**好消息**|維護管理本質就是**表單 + 工作流**(資產 / 工單 / 備品 / 保養計畫),是 Weyver substrate 的原生形狀。真正要自建的只有**預防保養觸發器三型**:依時間(固定 / 浮動週期)· 依使用量(讀數計 + 閾值,需處理回捲與補登)· **依狀態(感測值越限 → 與 MES Edge 採集天然接軌,規則交給已裁定的 GoRules ZEN 做視覺化綁定,符合第一約束)**。

MTBF/MTTR 不必外求,ISO 22400-2 已定義其時間元素(TBF / TTR / TTF / FE / CMT / PMT)。

### 6.4 ⭐ OEE|不能寫死成一條公式(落在命門原則上)

**三派分歧是業界事實**|
- **Nakajima / TPM**|基準為 loading time(**已扣除計畫停機**)→ 數字最高,「85% 世界級」是在此基準上說的。⚠️ 原書為紙本專書,**未取得逐字**。
- **SEMI E79**(官方摘要逐字)|"OEE = (Theoretical Production Time for Effective Units) / (**Total Time**)" → 分母是全日曆時間,天生比 TPM 低一大截。配套的 **SEMI E10 六種互斥設備狀態**是很好的資料模型骨架。
- **ISO 22400-2**|以 PBT(扣掉計畫停機)為基準,立場近 TPM 但定義精確得多。

**連 ISO 自己都並列兩種算法** —— 目錄逐字有「**Annex B (informative) Alternative OEE calculation based on loss time model**」。

**→ 實作裁定**|把 **ISO 22400-2 的時間元素做成可設定的 time-model**(PBT / AUBT / ADOT / ADET / PRI / PQ / GQ 各自綁到使用者表單欄位),再讓客戶選「TPM 基準 / 全日曆基準」。
理由有二:① 三派分歧是業界事實,**客戶會拿自己原本的數字來對**;② **OEE 的分母選擇是業務決策不是技術決策**,正好落在 [[feedback-calc-binding-self-service]]「算的綁定必須自助化」—— 不該由顧問寫死。

⚠️ ISO 22400-2 的 KPI 公式在付費 Clause 6,**未取得一手全文**;「34 個 KPI」為二手,不得寫成數字承諾。另 **ISO/DIS 22400-2 改版進行中**,實作前應確認採用版本。

---

## 7. 食品垂直|首波客戶直接相關

### 7.1 HACCP 七原則(Codex CXC 1-1969,2003 版逐字)

PRINCIPLE 1 Conduct a hazard analysis · 2 Determine the CCPs · 3 Establish critical limit(s) · 4 Establish a system to monitor control of the CCP · 5 Establish the corrective action · 6 Establish procedures for verification · 7 Establish documentation。

⚠️ **CXC 1-1969 已於 2020 與 2022 兩度改版**,改版後 Principle 1 措辭疑增補為 "…**and identify control measures**"(二手),2022 版新增決策樹 Annex。**FAO 官網 PDF 回 403,現行版逐字未取得** —— 寫入規格前須複核。

**對 Weyver 的意涵**|Principle 4(monitor)+ 7(documentation)是表單引擎的原生強項;而 **Principle 3(critical limits)與 5(corrective action)是「規則」不是「表單」** → 對映已裁定的 **GoRules ZEN** 視覺化規則引擎(`docs/20`),而非硬編碼。這是相對於「HACCP 紙本 + Excel」的真實向上點。

### 7.2 FSMA 204(21 CFR Part 1 Subpart S)

**七個 CTE**|Harvesting(§1.1325)· Cooling · Initial Packing(§1.1330)· First Land-Based Receiving(§1.1335)· **Shipping(§1.1340)· Receiving(§1.1345)· Transformation(§1.1350)**;另有 §1.1315 Traceability Plan 與 §1.1320 TLC 指派。

**🔴 Transformation 是模型上最關鍵的一條**|必須同時記錄輸入端(每個投入批的 TLC + 描述 + 數量)與輸出端(**新的 TLC** + 地點 + 完成日 + 描述 + 數量)。**Transformation 是唯一會斷鏈並生成新批號的事件,而食品加工廠的每一次投料生產都是 transformation。**
→ **Weyver 批次追蹤模組必須把「多對多的投入批 → 產出批」當一等公民,不能只做單層 parent-child。**

**⚠️ 生效日期已延期,務必用新日期**|原 compliance date 2026-01-20 → FDA 2025-08-07 提出延後 30 個月 → 且**國會於 Continuing Appropriations Act of 2026 指示 FDA 在 2028-07-20 前不得執法**。**現行有效日期:2028-07-20**;規則內容本身未修改。

### 7.3 EU 178/2002(一手逐字)

Article 18 §2(one step back)與 §3(one step forward)。
**⚠️ 條文只要求「上一手 / 下一手」,不要求內部批次串接** —— 歐盟門檻明顯低於 FSMA 204。**設計時以 FSMA 204 為上界,滿足它自然滿足 EU;反之不成立。**

### 7.4 台灣(首波客戶的硬需求)

依《食品及其相關產品追溯追蹤系統管理辦法》(母法:食安法第 9 條),製造加工業者應記錄原材料來源 / 產品資訊 / **批號標記(原材料、半成品、成品三段)** / 產品流向 / 庫存 / 報廢;**保存至少五年**。公告業者須**每月 10 日前**以電子方式申報至「**非追不可**」系統;罰則 3 萬至 300 萬元。

**三點直接意涵**|
1. **五年保存期** → 動態表單的 soft delete 與封存策略必須支撐 5 年且可稽核;
2. **半成品也要標記批號** → 法規明文三段標記,**比 EU 嚴、與 FSMA Transformation 同向**;
3. **每月電子申報 + 電子發票綁定** → 台灣獨有,與 R2 電子發票模組天然耦合。**「追溯資料 → 非追不可申報檔」應列為具名功能,不是泛稱的「匯出」。**

### 7.5 ⭐ EPCIS|批次追蹤的現成資料模型(GS1 EPCIS 2.0 逐字)

> "Each of the core event types... has fields that represent **five key dimensions**... conveniently remembered as **'what, when, where, why and how'**... The 'where' and 'why' dimensions have both a **retrospective aspect and a prospective aspect**."

**TransformationEvent 逐字**|"represents an event in which input objects are fully or partially consumed and output objects are produced, such that **any of the input objects may have contributed to all of the output objects**."
**→ 這句話應直接寫進 Weyver 批次追蹤 design doc §0 當設計約束。**

**四點可直接落地的洞見**|
1. **EPCIS 是事件流模型不是狀態表模型** —— 追溯是查詢的結果而非欄位,與 Weyver 傳票不可變 / audit 鐵則同構。**追溯關係不應存成物化欄位。**
2. **五維度剛好是通用表單的欄位骨架** → Weyver 可以只做**一張「追溯事件」表單型別**,`bizStep` 用 select 綁 CBV 詞彙表(41 個標準值可直接當預建選單),**完全落在既有 Ragic 範式內,不需要專用引擎**。
3. **retrospective / prospective 雙面設計可直接抄** —— 同一事件同時記「從哪來」與「要往哪去」,正是 FSMA 204 要求 immediate previous source / subsequent recipient 的來源。**若只記單向,對不上法規。**
4. **GS1 US《EPCIS Recommendations for FSMA 204 CTEs》公開免費**,把七個 CTE 逐一對映到 EPCIS 事件與 bizStep —— **這是 FSMA 204 → 資料模型的最短路徑。**

---

## 8. 向上設計裁定(過 `AGENTS.md` 三條檢驗)

### 8.1 ✅ 成立的向上主張

| 主張 | ① 巨人停在那裡(一手) | ② 架構讓我們過得去 | ③ 對取代 ERP 有意義 |
|---|---|---|---|
| **現場表單自助設計** | qcadoo 官方逐字:加功能要 `mvn archetype:generate` + XML + Java 重編譯;Odoo 的 no-code Studio **經複驗確不在 LGPL repo** | 表單引擎是 substrate,加欄位是原生能力非外掛 | 工廠主管要改一道工序的檢驗欄位,現況是找顧問寫程式 |
| **OEE 分母自助綁定** | ISO 自己並列兩種算法(Annex B);SEMI 與 TPM 基準不同 | 語意標記 + 人核准,落在既有計算層綁定機制 | 客戶會拿原本的數字來對,對不上就不信任 |
| **HACCP 臨界值 / 矯正措施視覺化規則** | Codex Principle 3、5 本質是規則 | GoRules ZEN 已裁定(`docs/20`) | 食品業首波客戶的合規剛需 |
| **MES + ISO 同一 substrate** | MESA WP#6 逐字把 ISO 文管與 CAPA 歸進 Document Control | 同一引擎上的不同表單 app | 客戶不必再買第二套系統 |

### 8.2 ⚠️ 不得宣稱的事(避免重演 `docs/17` 的教訓)

1. **不得宣稱「no-code MES 沒人做」** —— **Tulip** 是成熟的專有 no-code MES(app editor / citizen developer / 模板庫)。可成立的敘述僅限「**開源** MES 圈裡沒有一個提供終端使用者自助的表單 / 流程設計器」。
2. **不得宣稱「metadata 驅動」本身是差異化** —— **iDempiere / metasfresh 的 Application Dictionary 是真的 no-code**,官方逐字「New functionality can be added by creating new entries in the Dictionary, **often without the need for adding software**」,且有專頁教「Adding a Field to an existing Window」不需寫碼。**這是 Compiere 2001 年就有的東西,架構上與 Weyver 同源。** 差異在現代 UX 與**計算層的自助綁定**,不在 metadata 驅動這件事。
3. **不得宣稱「開源 MES 都要寫程式」** —— FUXA(`MIT`)證明純 GUI 建工廠畫面已被市場驗證。這對 Weyver 其實**有利**(證明可行),但敘述要準確。
4. **不得引用廠商行銷頁的授權宣稱**(万界星空案例)。

---

## 9. 對既有 docs 的更新建議(cascade)

| 文件 | 位置 | 建議動作 | 優先級 |
|---|---|---|---|
| **`docs/11`** | line 1152 | 🔴 「EMQX open-source edition(Apache 2.0)」**現為錯誤**,改為 NanoMQ(MIT)/ Mosquitto | **P0** |
| `docs/11` | §5.3 / §16.5–16.11 約 8 處 | EMQX 預設改為 NanoMQ;成本表同步 | P0 |
| `docs/11` | line 1326 | 交叉引用「授權替代見 §5.4」**指錯地方**,§5.4 未涉授權 | P1 |
| **`AGENTS.md`** | §5-bis 授權表 | 併入本文件 §1 的 MES 生態判定;新增三條規則:**GitHub License API 不可作唯一依據 / 廠商行銷頁不算數 / 同公司不同產品授權可不同** | **P0** |
| `docs/08` | §1.1 | 補註功能矩陣主軸改用 ISA-95 P3 4×8,MESA-11 降為次軸;修正「c-MES 壓成 8 項」的常見誤傳 | P1 |
| `docs/04 §T` | SPC 列 | 「暫緩」之判定與本研究「TS 自建 1–2 人月」有落差,建議 M0 重評 | P1 |
| `docs/14` | 新增節 | `[data-density="shopfloor"]` + alarm 四級 token + 看板/操作台雙字階 | P1 |
| `docs/24` | §6 | Rockwell「Level 2 先設計」為外部一手佐證,可補入 | P2 |
| **T 模組 M0**(未建立) | — | 需裁定:APS 跨語言 · UNS 與 PG 的 SSOT 邊界 · Node-RED 不交客戶 · shopfloor 權限顯示例外(§5.4) | **P0** |

---

## 10. 未查證清單(不得作承重依據)

- ISA-101.01 / EEMUA 191 / NAMUR NA 102 / ISO 9241-410 Annex J / SEMI E10·E79 **正文逐字**(皆付費未取得)
- ISO 22400-2 Clause 6 的 **KPI 公式本體**;「34 個 KPI」之數字;ISO/DIS 改版是否已發布
- Nelson rules 八條**原文措辭**(JQT 1984 付費牆)· Pp/Ppk 的 within vs overall sigma(ISO 22514-2 付費)· Nakajima 1988 OEE 定義與 85% 門檻(紙本專書)
- Codex CXC 1-1969 **2022 現行版逐字**(FAO PDF 回 403)
- ISA-88.00.01 標準原文逐字(層級名稱多來源一致可信,但個別術語定義不得標為逐字)
- ISA-95 Process Segment / Product Definition / Production Schedule / Production Performance 四物件的**逐字定義**
- 「Walker Reynolds 首創 UNS」之本人原始發表
- ktg-mes Gitee 主線的逐檔授權標頭與最後 commit 日;了云MES LICENSE 全文
- Odoo Community `iot_base` 的**實際可用性**;Axelor 圖形化 Studio 是否付費版限定
- NanoMQ SQLite bridge cache 的**實際可靠度**(issue #1980)—— **上線前必須自行壓測**
- FJSP 實務求解時間量級;JeecgBoot 授權附加條款(其線上表單開發能力與 Weyver 正面相關,值得另開一輪)

---

## 版本

- **2026-08-03 v1**|首版。六軸平行研究(專門 MES / ERP 製造模組 / IIoT 連線層 / SCADA-HMI / 演算法元件 / 標準框架),所有承重授權由本專案逐一複驗 LICENSE 檔。六個決定性結論:開源 MES 授權形狀不利(qcadoo AGPL 不可讀、UMH 非 MES)· 向上位置可稽核(開源圈無終端使用者設計器)· **EMQX 轉 BSL 推翻 `docs/11` 選型** · 功能矩陣軸改 ISA-95 P3 4×8 · **B2MML 為免費合法取得 ISA-95 物件模型之路徑** · APS 必須跨語言需獨立裁定。另記錄四起授權漂移與三條反面警示(不得宣稱 no-code MES 沒人做 / metadata 驅動非差異化 / 開源 MES 非都要寫程式)。
