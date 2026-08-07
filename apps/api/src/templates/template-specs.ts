import { z } from "zod"
import { CELL_VALUE_TYPES } from "../form-engine/field-types/field-type-registry.js"

/* 🔴 R1·TPL M1|範本包格式(`form-templates.md` OQ-TPL-1=B / OQ-TPL-2=A)。

   **單位是「包」不是「表」** —— 四家競品一致(§0.2,強證據):
   Ragic「大多模組包含多張表單,且彼此的連結關係已經建立好」·
   Teable `create-from-template` 的單位是整個 base ·
   Baserow「one or more applications」· Airtable template = 一整個 base。
   而容器邊界正好解掉 link 重指的難題:**關聯只存在包內**。

   **包內以相對代號互指**(OQ-TPL-2=A),不存真實 id:
   存真實 id 要在寫入後回頭掃描全部 metadata,漏一處就是壞掉的關聯而且不會報錯;
   相對代號讓「沒對應到的 ref」在**套用前**就驗得出來。

   範本本身**不進 DB**,以版控中的定義為來源(Baserow 形態:
   「everyone who self hosts also has access them」)—— R1 不做社群範本,
   DB 化只會多一套沒有寫入者的 CRUD。 */

const refSchema = z.string().regex(/^[a-z][a-z0-9_]{0,30}$/, "ref 須小寫字母開頭,限 a-z0-9_")

/* `link` 欄在範本裡用 `{ targetRef }` 取代 `{ targetFormId }`;
   套用時由 `ref → formId` 映射改寫。其餘 options 原樣帶過。

   ⚠️ **刻意不沿用 `addFieldSpecSchema`** —— 它的 `superRefine` 會對 `link` 要求
   `options.targetFormId`,而範本裡那個值**還不存在**(整個 `targetRef` 機制就是為此)。
   **完整的 options 驗證在套用時由 `createFormSpecSchema` 做** ——
   也就是說範本不會因為少驗一層而寫進不合法的欄位,只是驗的時機往後移。 */
export const templateFieldSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(CELL_VALUE_TYPES),
  required: z.boolean().default(false),
  unique: z.boolean().default(false),
  options: z.record(z.string(), z.unknown()).default({}),
  targetRef: refSchema.optional(),
})

/* 🔴 OQ-TPL-3 = B|範本要帶**版面**,不只欄位。

   「範本涵蓋多少」是核心 OQ,而 A(只有欄位)交付不出「打開就能用」的觀感 ——
   那正是範本的價值。只帶欄位的話,套出來是一排預設直排欄位,
   跟使用者自己建一張空白表沒兩樣。

   版面在範本裡以**欄位顯示名**為 key(id 還不存在),套用時換成真實 id。
   條件式格式不必轉換 —— 它本來就以欄位名指涉(`targets` / `conditions.field`)。 */
const templateFieldLayoutSchema = z.object({
  row: z.number().int().min(0).max(999),
  col: z.number().int().min(0).max(50),
  colSpan: z.number().int().min(1).max(50).optional(),
  help: z.string().max(1000).optional(),
  placeholder: z.string().max(200).optional(),
  readonly: z.boolean().optional(),
  hidden: z.boolean().optional(),
})

export const templateFormSchema = z.object({
  ref: refSchema,
  name: z.string().min(1).max(100),
  /* 子表:指向同包內另一張表的 ref */
  parentRef: refSchema.optional(),
  fields: z.array(templateFieldSchema).max(300),
  /* OQ-TPL-4=A:一個布林決定帶不帶範例資料(Teable 形態)——
     一個參數同時解掉「要不要帶」與「事後怎麼清」。
     Airtable 一律帶再提供清除,而它自己踩了坑:清除入口藏在一次性側欄。 */
  sampleRows: z.array(z.record(z.string(), z.unknown())).max(50).default([]),
  /* key = 欄位**顯示名**(套用時換成 id);未列的欄位由 `effectiveLayout` 自動排 */
  layout: z.record(z.string(), templateFieldLayoutSchema).optional(),
  gridCols: z.number().int().min(1).max(50).optional(),
})

export const templatePackSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9-]{1,40}$/),
  version: z.string().min(1).max(20),
  name: z.string().min(1).max(60),
  description: z.string().max(300),
  /* OQ-TPL-8=C:職能為主軸、產業為 pack。`industry` 為空 = 通用職能。 */
  industry: z.string().max(40).optional(),
  /* OQ-TPL-10=A:分類是**建議值** —— 同名沿用,否則建立。
     `form_categories` 沒有預設 seed,故範本帶進來的分類會實質決定租戶的分類體系;
     強制建立會在客戶既有的分類樹裡塞進陌生節點。 */
  categoryName: z.string().max(100).optional(),
  forms: z.array(templateFormSchema).min(1).max(20),
})

export type TemplatePack = z.infer<typeof templatePackSchema>
export type TemplateForm = z.infer<typeof templateFormSchema>

/* 套用前的靜態驗證。**在建任何表之前跑完** —— 建到一半才發現 ref 打錯,
   就得靠補償刪除去收拾,而補償本身也可能失敗。 */
export function validatePackRefs(pack: TemplatePack): string[] {
  const refs = new Set(pack.forms.map((f) => f.ref))
  const errors: string[] = []
  if (refs.size !== pack.forms.length) errors.push("包內有重複的 ref")
  for (const form of pack.forms) {
    if (form.parentRef !== undefined && !refs.has(form.parentRef)) {
      errors.push(`${form.ref}.parentRef 指向不存在的 ref:${form.parentRef}`)
    }
    if (form.parentRef === form.ref) errors.push(`${form.ref} 不能是自己的子表`)
    for (const field of form.fields) {
      if (field.targetRef !== undefined && !refs.has(field.targetRef)) {
        errors.push(`${form.ref}.${field.name} 指向不存在的 ref:${field.targetRef}`)
      }
    }
  }
  return errors
}

/* 建表順序:父表先於子表、被指向者先於指向者。
   回 `null` = 有環(A 的子表是 B、B 的子表是 A)——**環不是可以容忍的邊角**,
   它會讓建表卡死,必須在套用前擋下。 */
export function topoOrder(pack: TemplatePack): TemplateForm[] | null {
  const byRef = new Map(pack.forms.map((f) => [f.ref, f]))
  const out: TemplateForm[] = []
  const state = new Map<string, "visiting" | "done">()

  const visit = (form: TemplateForm): boolean => {
    const st = state.get(form.ref)
    if (st === "done") return true
    if (st === "visiting") return false // 環
    state.set(form.ref, "visiting")
    const deps = [
      ...(form.parentRef === undefined ? [] : [form.parentRef]),
      ...form.fields.flatMap((f) => (f.targetRef === undefined ? [] : [f.targetRef])),
    ]
    for (const dep of deps) {
      if (dep === form.ref) continue // 自指:link 指回本表是合法的(樹狀主檔)
      const target = byRef.get(dep)
      if (target !== undefined && !visit(target)) return false
    }
    state.set(form.ref, "done")
    out.push(form)
    return true
  }

  for (const form of pack.forms) if (!visit(form)) return null
  return out
}

/* 版本比較。packs 用 `"1.0"` 這種點分數字,**不是完整 semver** ——
   所以不引 semver 套件,免得為了三行邏輯多一個相依。

   回傳 <0 / 0 / >0。非數字段一律當 0(壞版本不該讓整個範本庫爆掉,
   它只會表現成「沒有新版」——安全的方向)。 */
export function compareVersion(a: string, b: string): number {
  const pa = a.split(".")
  const pb = b.split(".")
  const n = Math.max(pa.length, pb.length)
  for (let i = 0; i < n; i++) {
    const na = Number.parseInt(pa[i] ?? "0", 10)
    const nb = Number.parseInt(pb[i] ?? "0", 10)
    const va = Number.isNaN(na) ? 0 : na
    const vb = Number.isNaN(nb) ? 0 : nb
    if (va !== vb) return va < vb ? -1 : 1
  }
  return 0
}
