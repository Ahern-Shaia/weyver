# Weyver AI-native 向上設計

> **文件性質**|「向上設計」的核心軸 —— AI-native 是 Weyver 超越 Ragic / 傳統 ERP 的類別差異,不是加一個功能。
> **前提**|承接 docs/10 §6(Ragic 弱點:非 AI)+ docs/15/16(架構 metadata 驅動 + 真實表,天生 AI-friendly)+ docs/04 定位(Ragic 為基底取代 ERP)。
> **原則**|AI **提議,人核准**;企業級可審計;不碰帳、不繞權限。務實可行(LLM orchestration 為主,非自訓模型)。
> **版本**|2026-07-18 v1

---

## 0. 為什麼 AI-native 是「向上」而非「加功能」

- **Ragic / 鼎新 / 正航 / 傳統 ERP = 0 AI。** 這是整個品類的空白(docs/10 §6.4「進階 BI / AI 弱」)。
- **企業買方已在期待**(對照 docs/research 之用友「智能助手」、Dynamics「invoice capture / payment prediction」截圖方向)。
- **Weyver 有兩個別人沒有的先天優勢**|
  1. **架構天生 AI-friendly**(見 § 2):metadata 驅動 + 真實 Postgres 表 + 每表單自動 API → AI 的完美著力點。
  2. **團隊本來就 AI-native**(solo dev + Claude Code):做 AI 功能是本行,不是外掛。
- **戰略定位**|不喊「我們有 AI」,而是「**AI 讓你導入更快、用起來更省力、決策更有據** —— 這是 Ragic 給不了的」。

---

## 1. Weyver 架構為何天生 AI-friendly

| 架構特性(docs/15/16)| 讓哪種 AI 能力變簡單 |
|---|---|
| **metadata 驅動**(form_def / field_def…)| AI 建表 = 產生 metadata JSON,引擎直接吃 → **AI 生成表單極自然** |
| **真實 Postgres 表**(非 EAV/JSONB)| **NL → SQL** 直接對真實 schema 查詢,AI BI 天然可行 |
| **每表單自動 REST/tRPC API** | AI copilot 可透過既有 API 執行動作(帶權限 / audit) |
| **公式引擎(AST + 型別)** | AI 生成公式 → 引擎驗證再 commit,防幻覺 |
| **三層權限 + 租戶隔離** | AI 動作天然受既有 guard 約束,不會越權 / 跨租戶 |
| **統一 substrate** | 一套 AI 能力跨 ERP/MES/ISO 全模組復用 |

→ **關鍵洞見**|別家要「外掛 AI」,Weyver 是「AI 長在架構裡」。我們設計 substrate 時(docs/15)就已經鋪好 AI 的軌道。

---

## 2. 兩大價值模式

| 模式 | 做什麼 | 對誰 | 槓桿 |
|---|---|---|---|
| **A · 降門檻**(reduce friction)| AI 建表 / 遷移、NL 查詢、AI 公式、對話操作 | 導入者 + 日常使用者 | **最高** —— 直接打「重建 ERP 很累」的痛 + 讓自助真正成立 |
| **B · 加洞察**(add intelligence)| 異常偵測、預測、稽核建議、單據抽取 | 管理者 + 品保 / 財會 | 高 —— 企業決策價值,但多為 Phase 1-2 |

**先做 A(降門檻)** —— 它同時是**採用楔子**(GTM)、**導入加速器**(直接抵銷客戶把舊 ERP 搬進來的工),且 LLM orchestration 就能做,solo dev 可行。

---

## 3. 功能地圖(分級)

### Tier A|降門檻 · LLM orchestration · 高槓桿(MVP-adjacent)

| 功能 | 說明 | 可行性 |
|---|---|---|
| **⭐ AI 遷移 / 建表助手** | 貼舊 ERP 畫面截圖 / 上傳 Excel / 文字描述 → 生成等價 Weyver 表單(欄位 + 型別 + 公式 + 關聯 + 工作流)| 高(產 metadata JSON)|
| **NL 查詢 / 報表** | 「上月哪個供應商交貨最慢?」→ 生成查詢 / 圖表 / 檢視 | 高(NL→SQL on 真實表)|
| **AI 公式助手** | 「算含稅金額」→ 生成公式,引擎驗證 | 高 |

### Tier B|加洞察 · 部分 LLM · 部分需資料(Phase 1-2)

| 功能 | 說明 |
|---|---|
| **AI 單據抽取** | 供應商發票 / 送貨單拍照 → OCR + LLM 抽取 → 自動建單(對照 Dynamics invoice capture)|
| **AI 稽核 / CAPA 助手** | 品質異常 NCR → AI 建議根因(fishbone / 5-why)+ 矯正措施;ISO 文件合規檢查 |
| **對話式 Copilot** | 「把這三張採購單併一張」「核准 XX 供應商待審單」→ agent 透過表單 API 執行(需 guardrail)|

### Tier C|智慧分析 · 需 ML / 歷史資料(Phase 2+)

| 功能 | 說明 |
|---|---|
| **智慧對帳** | 自動配對 + 異常標記(取代 Q 對帳的人工)|
| **需求預測** | 輔助 MRP(銷售預測 → 淨需求)|
| **異常偵測 / 預警** | 庫存異常、OEE 下滑、成本偏差預警 |

---

## 4. ⭐ 旗艦功能|AI 遷移 / 建表助手(GTM 楔子)

**這是 AI-native 最強的一張牌 —— 同時解客戶最大痛點 + 最強對比 Ragic。**

- **客戶痛點**|把舊 ERP(鼎新/千奧)+ 既有 Excel 的內容,一張一張重建成表單,是導入最累的部分(Ragic 全靠手工)。
- **Weyver 做法**|
  1. **輸入**|貼舊 ERP 畫面截圖 / 上傳 Excel / 自然語言描述。
  2. **AI 理解**|多模態 LLM 辨識欄位、型別、關聯、單據結構(header + line items)、計算欄。
  3. **生成 metadata**|輸出 `form_def` + `field_def` + `subform_def` + `relation_def` + `formula_def` JSON。
  4. **人審 + 落地**|使用者在設計器預覽 / 微調 → 一鍵建表(引擎跑 DDL)。
- **為什麼可行**|Weyver 表單是 **metadata 驅動**(docs/15 § 3),AI 只需產出結構化 JSON,不需碰底層 —— **LLM structured output 的甜蜜區**。
- **GTM 話術**|「**貼上你舊 ERP 的畫面,Weyver 幫你搬過來**」—— 把導入從「數週手工重建」壓縮到「數小時 AI 生成 + 人審」。這是 Ragic 給不了的。
- **延伸**|Excel-to-form(docs/04 B 之 Ragic 招牌)AI 強化版:不只匯資料,還推斷型別 / 公式 / 關聯。

---

## 5. 架構整合(AI 如何接上 substrate)

```
使用者輸入(NL / 截圖 / Excel)
        │
   ┌────▼─────────────────────────┐
   │  AI Orchestration Layer      │  ← NestJS service(獨立 module)
   │  (prompt + tool + 驗證)      │
   └────┬──────────┬──────────┬───┘
        │ 產 metadata│ 產 SQL   │ 呼叫 API
   ┌────▼────┐ ┌────▼────┐ ┌───▼──────────┐
   │ 表單引擎 │ │ 唯讀查詢 │ │ 表單自動 API  │
   │(建表)  │ │ sandbox │ │(帶權限/audit)│
   └─────────┘ └─────────┘ └──────────────┘
```

- **產 metadata**|AI 建表 → 輸出 metadata JSON → 引擎驗證 schema → 人審 → DDL。
- **產 SQL**|NL 查詢 → AI 生成 SQL → **唯讀 sandbox**(限 SELECT + timeout + schema 約束 + 租戶綁定)執行 → 結果 / 圖表。
- **呼叫 API**|Copilot 動作 → 走既有表單自動 API → **自動繼承三層權限 + 租戶隔離 + audit + 工作流守衛**。
- **AI 層是獨立 NestJS module**(呼應 docs/11 modular monolith;未來可抽 service)。

---

## 6. 企業級 Guardrails(可信賴 = 差異化的另一半)

企業買方對「AI 碰財務系統」天生懷疑。**可信任的 AI 才是向上,炫技的 AI 是扣分。**

| 護欄 | 規則 |
|---|---|
| **AI 提議,人核准** | AI 只**草擬 / 建議 / 生成**;過帳 / 核准 / 送單一律需人確認。不自動碰帳 |
| **權限 / 租戶邊界** | AI 動作繼承使用者的三層權限 + 租戶隔離;AI 不能越權、不能跨租戶讀資料 |
| **可審計** | 每個 AI 動作寫 audit log;AI 生成內容標記「AI 生成」;可追溯 prompt / 模型 / 版本 |
| **幻覺防護** | NL→SQL 走唯讀 sandbox + schema 約束;AI 公式經引擎驗證才 commit;建表經人審 |
| **資料隱私** | 企業資料送 LLM 的邊界明確:PII 遮罩、不用於訓練、**提供 regional / self-host 模型選項**(見 § 7)|

> **一句話**|**「AI 幫你更快更省力,但每一筆帳還是你說了算,而且全程留痕。」** 這對食品廠 pilot / 未來合規審查都站得住。

---

## 7. OSS-only 原則的例外處理(LLM)

LLM 是 Weyver 唯一可能碰非 OSS 依賴的地方(見 [[oss-only-stack]])。分層處理:

| 場景 | 選擇 |
|---|---|
| 一般 AI 建表 / NL 查詢 / 助手 | **Claude API**(能力最強;需資料處理協議、不訓練承諾)|
| 資料敏感 / 客戶要求境內 | **self-host OSS 模型**(Llama / Qwen / DeepSeek 等,廠內或區域部署)|
| 極輕量分類 / 抽取 | 小型 OSS 模型 self-host,省成本 |

- **原則**|AI 能力**可插拔**(model provider 抽象層),客戶依隱私 / 成本選 API 或 self-host。
- **與 OSS-only 一致性**|軟體 stack 仍全 OSS;LLM 為「能力供應商」層,如同 infra(VPS)非 software licensing —— 提供 self-host OSS 模型選項即守住精神。

---

## 8. 落地順序建議

| 階段 | AI 功能 |
|---|---|
| **Phase 0(隨表單引擎)** | AI 公式助手(小)+ AI 建表助手 **v1**(文字 / Excel → 表單);先讓自助建表變快 |
| **Phase 1** | AI 建表助手 **v2**(截圖多模態 → 遷移楔子)+ NL 查詢 / 報表 + AI 單據抽取 |
| **Phase 2** | Copilot 動作 + AI 稽核 / CAPA + 智慧對帳 + 需求預測 / 異常偵測 |

- **人月影響**|Tier A 多為 LLM orchestration(引擎已鋪好軌道),增量有限;旗艦建表助手 v1 估 ~5-8 人月(含 prompt 工程 + metadata 生成驗證 + 設計器整合)。**待與 docs/04 一併校準,先不改 440。**
- **AI 抽象層**|建議 Phase 0 就把 model provider 抽象做好(可插拔),日後換模型 / 加 self-host 不動上層。

---

## 版本

- **2026-07-18 v1**|首版。AI-native 為「向上」類別差異(Ragic/傳統 ERP = 0 AI)。核心論點:Weyver 架構(metadata 驅動 + 真實表 + 表單 API)天生 AI-friendly。功能分級(A 降門檻 / B 加洞察 / C 智慧分析);旗艦「AI 遷移建表助手」為 GTM 楔子(貼舊 ERP 畫面 → 生成等價表單);企業級 guardrails(AI 提議人核准 / 可審計 / 權限租戶邊界 / 幻覺防護 / 隱私);OSS-only LLM 例外(可插拔 model provider + self-host 選項);落地順序 Phase 0-2。
