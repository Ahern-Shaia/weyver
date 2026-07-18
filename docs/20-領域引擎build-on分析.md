# Weyver「巨人肩膀」領域引擎 build-on 分析

> **文件性質**|風險降低策略。承接「是否該站在全球驗證的引擎上,而非自研高風險組件」的討論。針對三個最危險的自研領域(帳務 / 長流程 / 規則)研究成熟引擎,給 **build-on vs 自研** 決策。
> **配套**|docs/18(ERP 計算層)+ docs/15/16(表單引擎,已採 Baserow/Teable MIT)+ docs/11(技術棧)+ docs/17(AI-native)。
> **版本**|2026-07-18 v1

---

## 0. 框架:兩種巨人,結果相反

| 巨人類型 | 例子 | 對 Weyver |
|---|---|---|
| **❌ 整套 ERP 平台當底座** | Odoo / ERPNext / OFBiz | 打架定位(變「那個 ERP」,表單淪皮)+ Python/Java 破壞 TS 棧 + LGPL/GPL —— **拒絕**(呼應 docs/04 v2.0) |
| **✅ 領域引擎當底層零件** | 帳務 ledger / durable workflow / 決策規則引擎 | 塞在表單/計算層**底下**,不奪範式;「一切皆表單」不變,底層更可靠 —— **這才是巨人肩膀上向上設計** |

**已在站的巨人**|NestJS · Postgres · Drizzle · **Baserow core + Teable MIT(表單引擎/公式/canvas grid,docs/16)** · Glide grid · ECharts · BullMQ · Meilisearch。本文補三個新領域。

---

## 1. 三領域決策表(研究結論)

| 領域 | Verdict | 選擇 | 理由 |
|---|---|---|---|
| **決策 / 規則引擎** | ✅ **ADOPT** | **GoRules ZEN** | MIT、Rust 核心 + Node 綁定 in-process、決策表 + 現成 MIT 視覺編輯器 = no-code 定位 + 多租戶(per-tenant JDM JSON 存 PG)|
| **Durable workflow** | ✅ **ADOPT** | **DBOS**(+ 保留 BullMQ)| durable execution 為**函式庫**跑在既有 Postgres、官方 NestJS 整合、**近零額外 ops** |
| **帳務 / GL ledger** | ⚙️ **SELF-BUILD**(有藍圖)| Postgres 自研 + ERPNext/OFBiz 藍圖 + **TigerBeetle 為 escape hatch** | 沒有引擎給你 ERP 語意(CoA/期結/FX/估值/報表);自研本就必要 |

---

## 2. 決策 / 規則引擎 → 採用 GoRules ZEN ⭐

- **是什麼**|OSS 業務規則引擎(Rust 核心執行 JSON Decision Model)—— 決策表 + 分支 + 沙箱函數;**MIT 授權**(引擎 + React 視覺編輯器都 MIT,可商用嵌入)。
- **為什麼採用**|
  - **in-process TS 綁定**(`@gorules/zen-engine`),無需獨立 server,注入 NestJS。
  - **決策表模型**正好是稅務 / 定價 / 核准路由 / 驗證 / MRP 政策的形狀(勝 json-rules-engine 的裸 JSON;勝 Camunda 付費 + JVM;勝 Drools JVM)。
  - **現成視覺編輯器** = 非工程師可自建規則(對映 Weyver no-code)。
  - **多租戶天然**|每租戶 JDM JSON 存 Postgres,runtime 載入,**零 code deploy 換稅制 / 司法管轄**。
- **驅動**|稅務計算、定價折扣、核准路由(docs/04 C 單據流)、表單驗證、MRP 政策門檻。
- **Weyver 仍負責**|規則持久化(tenant-scoped / 版本 / audit)、編輯器嵌入、facts 組裝 + 輸出套用(side effect / 過帳 / 交易)、治理。ZEN 只算決策。
- ⚠️ **待驗**|`@gorules/zen-engine` TS 綁定版本穩定度;QuickJS 函數節點 50ms timeout 是否卡 MRP;GoRules Cloud BRMS 為付費(自 host OSS 引擎+編輯器即足)。

---

## 3. Durable Workflow → 採用 DBOS(+ 保留 BullMQ)

- **兩類流程**|(1) **fire-and-forget batch**(排程、MRP kick、通知)—— 整體重試安全 → **BullMQ 足夠**。(2) **長流程需 crash-resume**(期末結轉、對帳、電子發票 submit-then-poll、多步 / 等人數天的簽核)—— **durable execution** 的教科書案例。
- **選 DBOS**|
  - durable execution 為**函式庫**(`@DBOS.workflow()` decorator),state checkpoint 進**你既有的 Postgres**;crash 後從最後完成步驟續跑。
  - **官方 NestJS 整合**(`dbos-nest`),跑在 NestJS 行程內,**無額外 cluster / 無新 infra** —— 對 solo dev + modular monolith + 低 ops 完美。
  - 核心函式庫免費商用自 host(避開付費 **Conductor** 管理台即可)。
- **對照**|Temporal(gold standard,MIT,但需獨立 cluster,ops 重,solo 不划算 → 未來 outgrow DBOS 的 fallback)· Restate(Postgres-adjacent 但多一個 binary + BSL)· **跳過**:Camunda 8(prod 付費 + JVM)、Inngest(SSPL + cloud-centric)、Windmill(AGPL 貼近專有碼危險)。
- **用途**|DBOS → 期末結轉 / 對帳 / 電子發票 / 長簽核;BullMQ → 排程 batch / MRP kickoff / fan-out / 通知。

---

## 4. 帳務 / GL ledger → 自研(有藍圖)+ TigerBeetle escape hatch

**關鍵洞見(校正直覺)**|GL 風險**不在**複式借貸原語,而在 **CoA + 過帳規則 + 期末結轉 + FX 重估 + 估值 + 報表** —— **沒有任何引擎給你這些,你都得自建**。所以問題不是「買 vs 自建 ledger」,而是「要不要為了『借貸平衡原子性』多養一個 stateful 系統」。

- **MVP / Phase 0**|**自研複式簿記於 Postgres**(serializable transaction + append-only journal + 借貸平衡 constraint/trigger)—— 單一 datastore、與表單資料同交易邊界、完整多租戶掌控,最高架構契合。**藍圖**|研讀 **ERPNext `GL Entry` model + OFBiz OMG-GL entity 設計**(GPL/Apache,**合法可讀作參考**,不 embed)。→ 呼應 docs/18(自研)+ A16(合法來源),**新增 ERPNext/OFBiz 為參考藍圖**。
- **TigerBeetle escape hatch**|**Apache 2.0 乾淨**、專為「失效下正確性」設計的高效借貸原語。但它是**第二個 stateful DB**(旁掛 Postgres)+ 跨庫一致性稅,pilot 規模不划算。**保留為:若交易量 / 原子性證明成為真實瓶頸時的已知逃生路。**
- **跳過 Formance**|fintech wallet/flow 抽象,離 GL 語意更遠,且為 service 非 library。

---

## 5. 塞進表單範式底下(不破定位)

三個引擎都**在表單/計算層底下當零件**,不奪「一切皆表單」範式:

```
表單引擎 substrate(docs/15,Baserow/Teable MIT)
   │  單據 / 主檔 = 表單 app
   ▼
計算層(NestJS services,docs/18)
   ├─ 帳務:自研於 Postgres(ERPNext/OFBiz 藍圖;TigerBeetle escape hatch)
   ├─ 規則:GoRules ZEN(稅/定價/核准/驗證,per-tenant JDM)
   └─ 長流程:DBOS(結轉/對帳/發票/簽核 durable)+ BullMQ(batch)
```

---

## 6. AI-native 綜效(接 docs/17)⭐

**GoRules ZEN + AI 的組合是防禦性差異化**|
- **AI 生成決策表 → 客戶視覺化審核 / 編輯 → 確定性執行**。
- 這把 Weyver 從「另一個表單引擎」升級為「**AI-native + 規則驅動 + 客戶可自訂的 ERP**」—— AI 提議、規則引擎確定性執行、人可視覺化改,三者互補。呼應 docs/17 之 AI 提議人核准 guardrail。

---

## 7. 對其他 docs 的影響

| doc | 更新 |
|---|---|
| **docs/11**(技術棧)| §3 加 **GoRules ZEN**(規則)+ **DBOS**(durable workflow,+ BullMQ 分工) |
| **docs/18**(計算層)| 自研 verdict 確認;新增 **ERPNext/OFBiz 為合法參考藍圖**;規則走 ZEN、長流程走 DBOS;TigerBeetle escape hatch |
| **docs/17**(AI-native)| AI→決策表→視覺編輯 綜效強化 |
| **docs/15 §8**(工作流)| durable 部分改由 DBOS 承載 |

---

## 8. 授權 / ops 總表

| 引擎 | 授權 | ops | 決策 |
|---|---|---|---|
| GoRules ZEN | **MIT**(引擎 + 編輯器)| in-process,零 | ✅ 採用 |
| DBOS Transact | **OSS 免費**(Conductor 付費,不用)| library on 既有 PG,近零 | ✅ 採用 |
| BullMQ | MIT | 既有 | ✅ 保留(batch)|
| TigerBeetle | **Apache 2.0** | 第二 DB,中 | ⏸ escape hatch |
| Temporal | MIT | cluster,重 | ⏸ 未來 fallback |
| Camunda / Inngest / Windmill / Formance | 付費 / SSPL / AGPL / 不合 | — | ❌ 跳過 |

---

## 版本

- **2026-07-18 v1**|首版。框架:兩種巨人(整套 ERP 拒絕 / 領域引擎採用)。三領域決策:**規則 → 採用 GoRules ZEN**(MIT in-process 視覺編輯器,no-code + 多租戶 + AI 綜效)、**durable workflow → 採用 DBOS**(Postgres library,官方 NestJS,近零 ops)+ 保留 BullMQ、**帳務 GL → 自研於 Postgres**(ERPNext/OFBiz 合法藍圖,TigerBeetle Apache-2.0 escape hatch)。關鍵洞見:帳務風險在 ERP 語意非借貸原語,無引擎可代;規則/長流程是可復用原語,採用成熟引擎。全部塞在表單範式底下不破定位。
