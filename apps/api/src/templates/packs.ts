import { type TemplatePack, templatePackSchema } from "./template-specs.js"

/* 🔴 R1·TPL M4|首發範本集(OQ-TPL-8 = C / OQ-TPL-9 = C)。

   **主軸是職能不是產業。** `docs/04 v1.5` 明文「產品定位重申為**多產業通用** SaaS
   (**非食品業垂直**)…全域中性化食品業特化語言」——
   而範本庫是使用者第一眼看到的東西,**主軸放產業等於用範本庫把定位講反**。
   (v0.1 的首發集四個裡有三個是食品 / HACCP,已於 v0.2 更正。)

   **職能軸也更貼近使用者的提問**:他問的是「我想做某件事」,
   不是「我屬於哪個產業」。產業做成**可選 pack**,兩者不互斥。

   **總數維持個位數**(OQ-TPL-9):範本的價值在背書不在數量 ——
   對不會寫程式的使用者,10 個看不懂的範本比 3 個他認得的更糟。 */

const packs: unknown[] = [
  {
    key: "purchase-request",
    version: "1.0",
    name: "請購申請",
    description: "請購單 + 明細子表,附供應商主檔。最常見的內部申請流程。",
    categoryName: "採購",
    forms: [
      {
        ref: "vendors",
        name: "供應商",
        fields: [
          { name: "供應商名稱", type: "text", required: true },
          { name: "聯絡人", type: "text" },
          { name: "電話", type: "phone" },
        ],
        sampleRows: [{ 供應商名稱: "示例供應商", 聯絡人: "王小明", 電話: "02-1234-5678" }],
      },
      {
        ref: "requests",
        name: "請購單",
        fields: [
          { name: "單號", type: "autoNumber", options: { prefix: "PR" } },
          { name: "申請日", type: "date", required: true },
          { name: "供應商", type: "link", targetRef: "vendors" },
          { name: "用途說明", type: "longText" },
          {
            name: "狀態",
            type: "singleSelect",
            options: { choices: ["草稿", "簽核中", "已核准"] },
          },
        ],
      },
      {
        ref: "request_lines",
        name: "請購明細",
        parentRef: "requests",
        fields: [
          { name: "品名", type: "text", required: true },
          { name: "數量", type: "number" },
          { name: "預估單價", type: "money" },
        ],
      },
    ],
  },
  {
    key: "equipment-repair",
    version: "1.0",
    name: "設備報修",
    description: "報修單 + 設備主檔。誰報的、修好沒有、花了多久。",
    categoryName: "設備",
    forms: [
      {
        ref: "equipment",
        name: "設備主檔",
        fields: [
          { name: "設備編號", type: "text", required: true, unique: true },
          { name: "設備名稱", type: "text" },
          { name: "放置地點", type: "text" },
        ],
      },
      {
        ref: "repairs",
        name: "報修單",
        fields: [
          { name: "報修單號", type: "autoNumber", options: { prefix: "RP" } },
          { name: "設備", type: "link", targetRef: "equipment" },
          { name: "報修人", type: "member" },
          { name: "故障描述", type: "longText", required: true },
          {
            name: "處理狀態",
            type: "singleSelect",
            options: { choices: ["待處理", "處理中", "已完成"] },
          },
          { name: "完成日", type: "date" },
        ],
      },
    ],
  },
  {
    key: "inventory-count",
    version: "1.0",
    name: "庫存盤點",
    description: "盤點單 + 明細。帳面與實際的差異一眼看得到。",
    categoryName: "倉儲",
    forms: [
      {
        ref: "counts",
        name: "盤點單",
        fields: [
          { name: "盤點單號", type: "autoNumber", options: { prefix: "IC" } },
          { name: "盤點日", type: "date", required: true },
          { name: "盤點人", type: "member" },
        ],
      },
      {
        ref: "count_lines",
        name: "盤點明細",
        parentRef: "counts",
        fields: [
          { name: "品項", type: "text", required: true },
          { name: "帳面數量", type: "number" },
          { name: "實盤數量", type: "number" },
          /* 差異用公式而非讓人自己減 —— 「不用寫 code 也不用自己算」是第一屬性 */
          { name: "差異", type: "formula", options: { expression: "{實盤數量} - {帳面數量}" } },
        ],
      },
    ],
  },
  {
    key: "customer-directory",
    version: "1.0",
    name: "客戶名單",
    description: "最單純的一張主檔 —— 也是最多人第一張想建的表。",
    categoryName: "客戶",
    forms: [
      {
        ref: "customers",
        name: "客戶名單",
        fields: [
          { name: "客戶名稱", type: "text", required: true },
          { name: "統一編號", type: "text" },
          { name: "聯絡人", type: "text" },
          { name: "電話", type: "phone" },
          { name: "Email", type: "email" },
          { name: "地址", type: "text" },
        ],
        sampleRows: [{ 客戶名稱: "示例客戶股份有限公司", 聯絡人: "陳小華", 電話: "04-2345-6789" }],
      },
    ],
  },
  {
    key: "meeting-notes",
    version: "1.0",
    name: "會議紀錄",
    description: "會議紀錄 + 待辦子表。散在 Excel 與通訊軟體裡的東西收回一處。",
    categoryName: "行政",
    forms: [
      {
        ref: "meetings",
        name: "會議紀錄",
        fields: [
          { name: "會議主題", type: "text", required: true },
          { name: "會議日期", type: "date", required: true },
          { name: "主持人", type: "member" },
          { name: "決議事項", type: "longText" },
        ],
      },
      {
        ref: "action_items",
        name: "待辦事項",
        parentRef: "meetings",
        fields: [
          { name: "事項", type: "text", required: true },
          { name: "負責人", type: "member" },
          { name: "期限", type: "date" },
          { name: "已完成", type: "checkbox" },
        ],
      },
    ],
  },

  /* ── 以下為**食品加工 pack**(OQ-TPL-8 = C 的產業軸)。
     首波 pilot 集中食品 / 團膳,故它有真實的近期價值;
     但它是**可選的一包**,不是首發集的主體。 ── */
  {
    key: "food-incoming-inspection",
    version: "1.0",
    name: "進貨驗收",
    description: "食品加工:進貨驗收單 + 明細。溫度、效期、允收與否。",
    industry: "食品加工",
    categoryName: "品管",
    forms: [
      {
        ref: "receipts",
        name: "進貨驗收單",
        fields: [
          { name: "驗收單號", type: "autoNumber", options: { prefix: "RC" } },
          { name: "到貨日", type: "date", required: true },
          { name: "供應商", type: "text" },
          { name: "驗收人", type: "member" },
        ],
      },
      {
        ref: "receipt_lines",
        name: "驗收明細",
        parentRef: "receipts",
        fields: [
          { name: "品項", type: "text", required: true },
          { name: "批號", type: "text" },
          { name: "有效期限", type: "date" },
          { name: "到貨溫度", type: "number" },
          { name: "允收", type: "singleSelect", options: { choices: ["允收", "特採", "退貨"] } },
          { name: "異常說明", type: "longText" },
        ],
      },
    ],
  },
  {
    key: "food-daily-cleaning",
    version: "1.0",
    name: "每日清潔紀錄",
    description: "食品加工:逐區逐項的清潔查核,含簽名。",
    industry: "食品加工",
    categoryName: "品管",
    forms: [
      {
        ref: "cleaning",
        name: "每日清潔紀錄",
        fields: [
          { name: "日期", type: "date", required: true },
          {
            name: "區域",
            type: "singleSelect",
            options: { choices: ["前處理區", "加工區", "包裝區", "冷藏庫"] },
          },
          { name: "執行人", type: "member" },
          { name: "查核結果", type: "singleSelect", options: { choices: ["合格", "不合格"] } },
          { name: "缺失說明", type: "longText" },
          /* ⚠️ 簽名欄是**畫押圖片不是數位簽章**(OQ-IS-8 = A′)——
             UI 已對使用者明示,此處不再宣稱其法律效力 */
          { name: "確認簽名", type: "signature" },
        ],
      },
    ],
  },
  {
    key: "food-ccp-monitoring",
    version: "1.0",
    name: "CCP 監控",
    description: "食品加工:關鍵管制點監控與偏差矯正。HACCP 文件的日常紀錄面。",
    industry: "食品加工",
    categoryName: "品管",
    forms: [
      {
        ref: "ccp",
        name: "CCP 監控紀錄",
        fields: [
          { name: "監控時間", type: "dateTime", required: true },
          { name: "管制點", type: "text", required: true },
          { name: "監控值", type: "number" },
          { name: "管制上限", type: "number" },
          { name: "管制下限", type: "number" },
          { name: "監控人", type: "member" },
          { name: "是否偏差", type: "checkbox" },
          { name: "矯正措施", type: "longText" },
        ],
      },
    ],
  },
]

export const TEMPLATE_PACKS: readonly TemplatePack[] = packs.map((p) => templatePackSchema.parse(p))

export function findPack(key: string): TemplatePack | undefined {
  return TEMPLATE_PACKS.find((p) => p.key === key)
}
