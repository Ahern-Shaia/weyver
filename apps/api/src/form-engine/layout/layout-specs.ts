import { z } from "zod"

/* R1·UP-3 2D 設計器版面 metadata(form_def.layout;OQ-FD2-1=A 單一 JSONB 承載整表)。
   版面與資料正交:座標/設定/靜態/分段皆此;DDL/DML 鏈不動。 */

/* 預設值變數(P0 = create-time 集;# 修改時 + $SEQ 為 P1,OQ-FD2-6)*/
export const DEFAULT_VARIABLES = [
  "$DATE",
  "$TIME",
  "$DATETIME",
  "$YEAR",
  "$MONTH",
  "$WEEKDAY",
  "$USERID",
  "$USERNAME",
] as const
export type DefaultVariable = (typeof DEFAULT_VARIABLES)[number]

export const defaultValueSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("literal"), value: z.string().max(500) }),
  z.object({ kind: z.literal("variable"), value: z.enum(DEFAULT_VARIABLES) }),
  z.object({ kind: z.literal("formula"), value: z.string().max(2000) }),
])
export type DefaultValue = z.infer<typeof defaultValueSchema>

/* 靜態元素 / 分段之樣式(顯示層) */
const styleSchema = z
  .object({
    font: z.string().max(60).optional(),
    size: z.number().int().min(8).max(72).optional(),
    color: z.string().max(30).optional(),
    align: z.enum(["left", "center", "right"]).optional(),
    bg: z.string().max(30).optional(),
  })
  .strict()

/* href/imageUrl 僅允 https 或站內相對路徑(擋 javascript:/data: 等 XSS scheme;SSRF 見 §7-bis) */
const safeUrl = z
  .string()
  .max(2000)
  .refine((u) => /^https:\/\//.test(u) || u.startsWith("/"), "url 僅允 https 或相對路徑")

export const fieldLayoutSchema = z
  .object({
    row: z.number().int().min(0).max(999),
    col: z.number().int().min(0).max(50),
    colSpan: z.number().int().min(1).max(50).optional(),
    placeholder: z.string().max(200).optional(),
    help: z.string().max(1000).optional(),
    readonly: z.boolean().optional(),
    hidden: z.boolean().optional(),
    defaultValue: defaultValueSchema.optional(),
  })
  .strict()

export const staticElementSchema = z
  .object({
    id: z.string().min(1).max(60),
    kind: z.enum(["text", "image"]),
    row: z.number().int().min(0).max(999),
    col: z.number().int().min(0).max(50),
    colSpan: z.number().int().min(1).max(50).optional(),
    text: z.string().max(5000).optional(),
    markdown: z.boolean().optional(),
    href: safeUrl.optional(),
    imageUrl: safeUrl.optional(),
    designOnly: z.boolean().optional(),
    style: styleSchema.optional(),
  })
  .strict()

export const sectionSchema = z
  .object({
    id: z.string().min(1).max(60),
    name: z.string().max(100),
    fromRow: z.number().int().min(0).max(999),
    toRow: z.number().int().min(0).max(999),
    style: styleSchema.optional(),
  })
  .strict()

/* R1·UP-3b 條件式格式(加法 optional,零 migration)。

   採 Ragic 範式(OQ-CF-1/3/5/7):**表單級**設定、著色**欄位值與標題**(非整列)、
   **後者覆蓋**、記錄頁與列表頁**各自獨立**一組規則。

   條件複用 `FILTER_OPERATORS`(OQ-CF-4)—— 與列表篩選同一組運算子,
   「篩得到的」與「上色的」語意才會一致(FMEA G3)。
   顏色為 12 tone 受控白名單(OQ-CF-2,docs/14 §0.2),**非自由 hex**:
   前端另以查表映射成 class,兩側皆不接受任意值(FMEA G1)。 */
export const FORMAT_TONES = [
  "ok",
  "warn",
  "error",
  "neutral",
  "c1",
  "c2",
  "c3",
  "c4",
  "c5",
  "c6",
  "c7",
  "c8",
] as const

/* 🔴 條件式格式的運算子**自成一份**,不與 `FILTER_OPERATORS` 共用。

   兩者是不同的領域:`FILTER_OPERATORS` 會編成 **SQL WHERE**,
   而這一份是**規則求值器**(`@weyver/rules`,前後端共用)在跑的。
   把 `between` / 群組運算子加進前者,它們會漏進查詢路徑 ——
   而那裡沒有實作,結果是**無聲的無效條件**(篩選看起來套了卻沒作用)。

   共用的那幾個刻意重列而不是展開 `FILTER_OPERATORS`:兩份清單的演化速度不同,
   自動同步只會讓某一天多出來的 SQL 運算子悄悄變成合法的格式條件。 */
export const FORMAT_OPERATORS = [
  "eq",
  "neq",
  "contains",
  "gt",
  "gte",
  "lt",
  "lte",
  "anyOf",
  "isEmpty",
  "isNotEmpty",
  /* v1.4|Ragic `doc/6`「指定日期欄位時間或區間」/「指定當前時間」 */
  "between",
  "dailyBetween",
  /* v1.4|「指定使用者或群組」—— 四種都給,「不屬於任一」與「不屬於全部」是兩件事 */
  "inAnyGroup",
  "notInAnyGroup",
  "inAllGroups",
  "notInAllGroups",
] as const

export const formatConditionSchema = z
  .object({
    /* 欄位顯示名,或虛擬欄位 `$now` / `$actor`(`@weyver/rules` 之 `PSEUDO_FIELDS`)。
       `$` 撞不到使用者欄位:動態 identifier 鎖 `^[a-z_][a-z0-9_]{0,62}$`。 */
    field: z.string().min(1).max(100),
    op: z.enum(FORMAT_OPERATORS),
    value: z.unknown().optional(),
  })
  .strict()

export const formatEffectSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("color"), tone: z.enum(FORMAT_TONES) }).strict(),
  /* 🔴 C-2 純呈現效果。**與已出貨的靜態 `fields[].hidden` / `readonly` 同級** ——
     兩者都只在前端生效,故本批不改變任何伺服器強制面(C-3 才會)。
     ⚠️ 沿用 Ragic / Airtable 的明文警告:**隱藏不是權限**,
     欄位級保護走權限設定(E-1 後端 assertWritable / maskRead)。 */
  z
    .object({ kind: z.literal("hide") })
    .strict(),
  z.object({ kind: z.literal("readonly") }).strict(),
  /* 🔴 C-2 後半|顯示訊息(OQ-CF-11)。**規則層效果,不落在任何欄位上**。

     文字可含欄位參數 `{{fieldValue:欄名}}` / `{{fieldName:欄名}}`。
     Ragic 用的是欄位編號(`{{fieldValue_1000199}}`),我方一律用**欄名** ——
     `conditions.field` 與 `targets` 都是欄名,再引進一套 id 指涉等於要使用者學兩套。
     分隔符改冒號且**只切第一個**:欄名可以含底線,Ragic 用 id 才沒有這個歧義。

     ⚠️ 插值與渲染的兩條硬約束在**前端**(求值在前端,OQ-CF-6=A):
     值取不到時回具名的「(無權檢視)」而非留空;訊息一律純文字,不吃 markdown/HTML。 */
  z
    .object({ kind: z.literal("message"), text: z.string().min(1).max(500) })
    .strict(),
  /* 🔴 C-3|條件式必填 —— **本模組第一個伺服器強制的效果**。

     只在前端做的必填是裝飾,直接打 API 就繞過去了。故求值器移進
     `@weyver/rules` 由前後端共用,`RecordService` 在寫入時再判一次。

     ⚠️ 官方對必填**沒有**「條件式優先於欄位屬性」那句(那句只給唯讀),
     只說已設必填的欄位在設定條件式格式時**無法選擇** —— 故靜態必填仍必填,
     規則只能再加上必填。詳見 `resolveFieldAttrs`。 */
  z
    .object({ kind: z.literal("required") })
    .strict(),
])

/* 🔴 OQ-CF-8 重裁 = 選項 C-1(2026-08-03):**規則的形狀現在定死,效果的覆蓋面分層補**。

   原模型是 `{ …, tone }` —— 一條規則恆等於「變一個顏色」,沒有判別欄。
   而一手查證(§0.2,Ragic `doc/6`)顯示它對標的「條件式格式」整頁 17 節、
   **效果類 10 項**(顯示/隱藏欄位、欄位值、敘述欄位、設定顏色、分段顯示隱藏上鎖、
   顯示訊息、動作按鈕顯示隱藏上鎖、欄位唯讀、欄位必填、開始簽核),
   且官方示範的**第一條規則是「顯示」、第二條才是「變色」——同一入口同一清單**。

   **為什麼是現在改**:此刻 `conditionalFormats` 的持久化資料為零、引用僅 4 檔,
   改形狀的成本接近改兩份 schema 定義;而另開第二份「條件式行為」清單的總成本
   **嚴格較高**(多一次合併遷移),且分成兩份之後 Ragic 用一整節解釋的
   「同一欄位被多條規則涵蓋時由上而下、後者覆蓋」在本產品裡**結構上表達不出來**。

   **仍未新增任何伺服器強制面**:C-2 全數(color / hide / readonly / 分段 / 訊息)
   都只在前端生效;需伺服器參與的三項(required / 動作按鈕 / 簽核按鈕)為 C-3 單獨排程。 */
export const formatRuleSchema = z
  .object({
    combinator: z.enum(["and", "or"]).default("and"),
    conditions: z.array(formatConditionSchema).min(1).max(20),
    /* 套用到哪些欄位(顯示名);空 = 條件所涉之欄位 */
    targets: z.array(z.string().min(1).max(100)).max(50).default([]),
    /* 🔴 C-2 後半|分段是**目標選擇器**,不是新的效果類(OQ-CF-9)。

       官方逐字:「就可以將相關欄位設成同一分段後,再透過條件式格式一次設定,
       **就無需逐一針對各欄位進行設定**」—— 它是批次捷徑,效果就是欄位級的那一組。
       求值時展開成該分段列區間內的欄位,**與 `targets` 併集**。

       這樣仲裁空間仍然只有一個(每個欄位),Ragic 的「由上而下、後者覆蓋」
       跨分段級與欄位級規則自動一致;另立一軸就會重蹈 §10-bis 選項 A 的兩份真相。
       「上鎖」不需要新效果 —— 逐字「若選擇將分段上鎖,該分段會變為**唯讀**狀態」。 */
    targetSections: z.array(z.string().min(1).max(60)).max(20).default([]),
    /* 🔴 C-3|動作按鈕。以 **id** 指涉:按鈕會改名,id 不會(同 `loadMap` 的理由)。
       官方的動詞與分段那組完全一樣(顯示 / 隱藏 / 上鎖),故沿用同一組效果,
       **不另立 `buttonHide` / `buttonLock`** —— 同一個心智動作不該有兩套名字。 */
    targetButtons: z.array(z.number().int().positive()).max(50).default([]),
    /* 🔴 C-3|「開始簽核」按鈕。它不是使用者建立的按鈕、沒有 id,故為布林。
       官方逐字:「當『銷售訂單』的總金額超過一萬元時才需要進行簽核流程,
       就可以設定條件式格式,讓『開始簽核』按鈕僅在總金額符合條件時顯示。」 */
    targetApproval: z.boolean().default(false),
    effects: z.array(formatEffectSchema).min(1).max(10),
    /* Ragic 的規則清單有這兩欄 —— 規則多起來之後,沒有註解就沒人敢動別人設的規則 */
    note: z.string().max(200).optional(),
    enabled: z.boolean().default(true),
  })
  .strict()

/* 相容讀取器:既有 `{ …, tone }` 於解析時升級為 `{ effects: [{ kind: "color", tone }] }`。
   目前並無此形態的持久化資料(改形狀選在資料為零時正是為此),
   但 client 可能送舊形狀,且日後回讀舊備份也走這裡。 */
export const formatRuleInputSchema = z.preprocess((raw) => {
  if (typeof raw !== "object" || raw === null) return raw
  const o = raw as Record<string, unknown>
  if (o.effects !== undefined || o.tone === undefined) return raw
  const { tone, ...rest } = o
  return { ...rest, effects: [{ kind: "color", tone }] }
}, formatRuleSchema)

export const conditionalFormatsSchema = z
  .object({
    record: z.array(formatRuleInputSchema).max(20).default([]),
    list: z.array(formatRuleInputSchema).max(20).default([]),
  })
  .strict()

export type FormatEffect = z.infer<typeof formatEffectSchema>
export type FormatRule = z.infer<typeof formatRuleSchema>
export type ConditionalFormats = z.infer<typeof conditionalFormatsSchema>

export const layoutSchema = z
  .object({
    /* 🔴 樂觀鎖(#109)。整表覆寫下,兩人同改後寫者會蓋掉整張版面。
       未帶時維持舊行為(既有呼叫端與測試不受影響)。 */
    expectedVersion: z.number().int().positive().optional(),
    /* 🔴 2026-08-03 移除 `rowHeights` / `colWidths`(稽核 R2)。
       兩者 schema 兩端俱全(含 min/max),但 **reader 0、writer 0** ——
       沒有任何地方寫得進去,也沒有任何地方讀得出來,存在了就只是**陷阱**:
       下一個人看到 schema 會以為做過了(已經發生過一次)。
       維持現狀是三個選項裡最差的一個。

       **真正有人要的那個功能歸別處**(R3):列表頁的欄寬調整走 `view_def`,
       沿用 Glide 內建的 `onColumnResize`(全 repo 亦零使用)——
       表單畫布的欄寬與列表頁的欄寬是兩件事,不共用資料。
       表單畫布的寬度已由 `colSpan` 表達。 */
    grid: z
      .object({
        cols: z.number().int().min(1).max(50).default(12),
      })
      .default({ cols: 12 }),
    // key = fieldId(字串);PUT 時驗 key ⊆ 該 form 現存 field_def id
    fields: z.record(z.string(), fieldLayoutSchema).default({}),
    statics: z.array(staticElementSchema).max(200).default([]),
    sections: z.array(sectionSchema).max(50).default([]),
    /* R1·後續-2 列印設定(加法 optional,零 migration;OQ-PM-6=A 列範圍語意,承 Ragic doc/149)。
       紙張/邊界/方向刻意不自建 —— 委派瀏覽器列印對話框(OQ-PM-3)。 */
    print: z
      .object({
        headerRows: z.array(z.number().int().min(0).max(999)).max(20).default([]),
        footerRows: z.array(z.number().int().min(0).max(999)).max(20).default([]),
        pageBreakAfterRows: z.array(z.number().int().min(0).max(999)).max(50).default([]),
      })
      .strict()
      .optional(),
    /* R1·UP-3b 條件式格式(見上;optional = 既有表單零遷移) */
    conditionalFormats: conditionalFormatsSchema.optional(),
  })
  .strict()

export type Layout = z.infer<typeof layoutSchema>
