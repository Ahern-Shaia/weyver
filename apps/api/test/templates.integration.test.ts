import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify"
import { Test } from "@nestjs/testing"
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createDrizzle } from "../src/db/db.module.js"
import { runMigrations } from "../src/db/migrate.js"
import { tenants } from "../src/db/schema.js"
import { DdlService } from "../src/form-engine/ddl/ddl.service.js"
import { MetadataService } from "../src/form-engine/metadata/metadata.service.js"
import { TemplateInstallService } from "../src/templates/install.service.js"
import { TEMPLATE_PACKS } from "../src/templates/packs.js"
import { templatePackSchema } from "../src/templates/template-specs.js"
import { TemplateService } from "../src/templates/template.service.js"
import { TemplateUpdateService } from "../src/templates/update.service.js"
import { PG_TEST_IMAGE } from "./pg-image.js"

/* 🔴 R1·TPL M1|套用範本包。

   兩個承重點:
   ① **包內以相對代號互指**(OQ-TPL-2=A)—— 套用後 link 要真的指到同包內那張表,
      而不是一個壞掉的、不會報錯的關聯。
   ② **全成或全不成**(OQ-TPL-5=A)—— `createForm` 是多階段的,沒辦法包進單一 tx,
      故以補償刪除達成。**半套的應用最糟**:使用者沒看過完整版,看不出來少了什麼。 */

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let app: NestFastifyApplication
let templates: TemplateService
let installs: TemplateInstallService
let updates: TemplateUpdateService
let metadata: MetadataService
let ddl: DdlService
let tenantA = 0
let tenantB = 0

beforeAll(async () => {
  container = await new PostgreSqlContainer(PG_TEST_IMAGE).start()
  pool = new pg.Pool({ connectionString: container.getConnectionUri(), max: 5 })
  await runMigrations(pool)
  const rows = await createDrizzle(pool)
    .insert(tenants)
    .values([{ name: "範本租戶" }, { name: "隔壁租戶" }])
    .returning()
  tenantA = rows[0]?.id ?? 0
  tenantB = rows[1]?.id ?? 0

  /* 🔴 app 車道必須是**受限角色**,不能是 superuser。
     拿 superuser 當 app 車道時 RLS 與 grant 一律不執法 ——
     `pitfall-privileged-lane-masks-security`,測試綠而線上壞。
     M6 新增的 template_installs / template_install_forms 兩張表都有 RLS + grant,
     沿用 superuser 的話這兩樣東西在測試裡完全不會被走到。 */
  await pool.query(
    `CREATE ROLE app_login LOGIN PASSWORD 'app_login' NOSUPERUSER NOBYPASSRLS;
     GRANT weyver_app TO app_login`,
  )
  const appUri = new URL(container.getConnectionUri())
  appUri.username = "app_login"
  appUri.password = "app_login"
  process.env.DATABASE_URL = container.getConnectionUri()
  process.env.APP_DATABASE_URL = appUri.toString()
  const { AppModule } = await import("../src/app.module.js")
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await app.init()
  await app.getHttpAdapter().getInstance().ready()
  templates = app.get(TemplateService)
  installs = app.get(TemplateInstallService)
  updates = app.get(TemplateUpdateService)
  metadata = app.get(MetadataService)
  ddl = app.get(DdlService)
}, 180_000)

afterAll(async () => {
  await app?.close()
  await pool?.end()
  await container?.stop()
})

const formCount = async (): Promise<number> => {
  const r = await pool.query(
    "SELECT count(*)::int AS n FROM form_def WHERE tenant_id = $1 AND deleted_at IS NULL",
    [tenantA],
  )
  return (r.rows[0] as { n: number }).n
}

describe("套用範本包", () => {
  it("🔴 包內的 link 套用後指到同包內那張表(相對代號解析)", async () => {
    const pack = templatePackSchema.parse({
      key: "purchase",
      version: "1.0",
      name: "請購",
      description: "",
      forms: [
        {
          ref: "vendors",
          name: `供應商_${String(Date.now()).slice(-5)}`,
          fields: [{ name: "名稱", type: "text" }],
        },
        {
          ref: "orders",
          name: `請購單_${String(Date.now()).slice(-5)}`,
          fields: [
            { name: "單號", type: "text" },
            { name: "供應商", type: "link", targetRef: "vendors" },
          ],
        },
      ],
    })
    const res = await templates.apply(tenantA, pack, 1)
    expect(res.formIds).toHaveLength(2)

    const field = await pool.query(
      "SELECT options FROM field_def WHERE tenant_id = $1 AND form_id = $2 AND name = '供應商'",
      [tenantA, res.refMap.orders],
    )
    const options = (field.rows[0] as { options: { targetFormId?: number } }).options
    /* 這一條就是 OQ-TPL-2=A 的全部理由:存真實 id 的話,漏改一處只會變成
       一個壞掉的關聯,而且不會報錯 */
    expect(options.targetFormId).toBe(res.refMap.vendors)
  })

  it("🔴 中途失敗 → 補償刪除,不留半套的應用(OQ-TPL-5)", async () => {
    const before = await formCount()
    const pack = templatePackSchema.parse({
      key: "broken",
      version: "1.0",
      name: "壞包",
      description: "",
      forms: [
        {
          ref: "good",
          name: `好表_${String(Date.now()).slice(-5)}`,
          fields: [{ name: "甲", type: "text" }],
        },
        /* 第二張的欄位型別合法但 options 不合法 → `createFormSpecSchema` 會擋,
           而此時第一張**已經建好了** */
        {
          ref: "bad",
          name: `壞表_${String(Date.now()).slice(-5)}`,
          fields: [{ name: "乙", type: "formula", options: {} }],
        },
      ],
    })
    await expect(templates.apply(tenantA, pack, 1)).rejects.toThrow()
    /* 第一張必須被收掉 —— 使用者沒看過完整版,留一張下來他看不出來少了什麼 */
    expect(await formCount()).toBe(before)
  })

  it("ref 打錯 → 在建任何表之前就擋下(沒有副作用要補償)", async () => {
    const before = await formCount()
    const pack = templatePackSchema.parse({
      key: "badref",
      version: "1.0",
      name: "壞 ref",
      description: "",
      forms: [
        { ref: "a", name: "甲表", fields: [{ name: "關聯", type: "link", targetRef: "ghost" }] },
      ],
    })
    await expect(templates.apply(tenantA, pack, 1)).rejects.toThrow(/ghost/)
    expect(await formCount()).toBe(before)
  })
})

/* 🔴 M4|**首發範本集的每一個包都要真的套得起來**。

   包的 schema 在 module load 時就驗了,但**欄位 options 要到套用時才驗**
   (`createFormSpecSchema`)—— 也就是說一個寫錯的 `singleSelect.choices` 或
   `formula.expression` 在單元測試裡完全看不出來,而使用者按下去才炸。
   這正是本專案反覆踩到的形狀:**有資料、沒人驗過**。 */
describe("首發範本集", () => {
  it("九個包全部套得起來(逐包實建再收掉)", async () => {
    expect(TEMPLATE_PACKS.length).toBeGreaterThanOrEqual(8)
    for (const pack of TEMPLATE_PACKS) {
      const unique = {
        ...pack,
        forms: pack.forms.map((f) => ({ ...f, name: `${f.name}_${String(Date.now()).slice(-6)}` })),
      }
      const res = await templates.apply(tenantA, unique, 1, { withRecords: true })
      expect(res.formIds.length, `${pack.key} 應建出 ${String(pack.forms.length)} 張`).toBe(
        pack.forms.length,
      )
    }
  }, 120_000)

  /* OQ-TPL-8 = C:主軸是職能不是產業。
     ⚠️ 這條看起來像在測資料,實際在測**定位** —— v0.1 的首發集四個裡三個是食品,
     而 docs/04 v1.5 明文「多產業通用、非食品業垂直」。退化時沒有任何技術訊號。 */
  it("🔴 通用職能範本必須多於產業範本(否則用範本庫把定位講反了)", () => {
    const generic = TEMPLATE_PACKS.filter((p) => p.industry === undefined)
    const industry = TEMPLATE_PACKS.filter((p) => p.industry !== undefined)
    expect(generic.length).toBeGreaterThan(industry.length)
  })
})

/* 🔴 同一個範本套第二次 —— **實走時抓到的真缺陷**。

   原本會撞表單名唯一,而回給使用者的是「internal error」:
   使用者的意圖通常是「我要再一份」(不同部門 / 不同年度),
   而他得到的是一句什麼都沒說的錯誤。
   改為自動加序號,**並把改了哪些名字回報出去** —— 靜默改名跟靜默不改一樣糟
   (使用者會以為套用失敗了,因為找不到他預期的那個名字)。 */
describe("重複套用同一個範本", () => {
  it("🔴 第二次套用不失敗,同名自動加序號並回報", async () => {
    const pack = templatePackSchema.parse({
      key: "twice",
      version: "1.0",
      name: "重複",
      description: "",
      forms: [
        {
          ref: "a",
          name: `重複表_${String(Date.now()).slice(-5)}`,
          fields: [{ name: "甲", type: "text" }],
        },
      ],
    })
    const first = await templates.apply(tenantA, pack, 1)
    expect(first.renamed).toEqual([])

    const second = await templates.apply(tenantA, pack, 1)
    expect(second.formIds).toHaveLength(1)
    expect(second.renamed[0]).toContain("(2)")
  })
})

/* 🔴 OQ-TPL-3 = B|範本要帶**版面**,不只欄位。

   「只帶欄位」交付不出「打開就能用」的觀感,而那正是範本的價值 ——
   套出來若是一排預設直排欄位,跟使用者自己建一張空白表沒兩樣。
   版面在範本裡以**欄位顯示名**為 key(id 還不存在),此測試釘的是那層轉換。 */
describe("版面帶入", () => {
  it("🔴 範本的版面套用後以真實 field id 落在 form_def.layout", async () => {
    const stamp = String(Date.now()).slice(-5)
    const pack = templatePackSchema.parse({
      key: "with-layout",
      version: "1.0",
      name: "帶版面",
      description: "",
      forms: [
        {
          ref: "a",
          name: `版面表_${stamp}`,
          fields: [
            { name: "甲", type: "text" },
            { name: "乙", type: "text" },
          ],
          layout: { 甲: { row: 0, col: 0, colSpan: 6 }, 乙: { row: 0, col: 6, colSpan: 6 } },
        },
      ],
    })
    const res = await templates.apply(tenantA, pack, 1)
    const formId = res.formIds[0] ?? 0

    const r = await pool.query("SELECT layout FROM form_def WHERE id = $1", [formId])
    const layout = (r.rows[0] as { layout: { fields: Record<string, { col: number }> } }).layout
    const ids = await pool.query(
      "SELECT id, name FROM field_def WHERE form_id = $1 AND deleted_at IS NULL",
      [formId],
    )
    const byName = new Map(
      (ids.rows as { id: string; name: string }[]).map((x) => [x.name, String(x.id)]),
    )
    /* key 必須是**真實 id** 不是欄位名 —— 存欄位名的話 layout 讀取端一個也對不上,
       而畫面看起來只是「排版沒生效」,指不到原因 */
    expect(layout.fields[byName.get("甲") ?? ""]?.col).toBe(0)
    expect(layout.fields[byName.get("乙") ?? ""]?.col).toBe(6)
  })

  /* 範本改版時欄位可能改名 —— 為了一個排版問題讓整包回滾不划算(表已建好且可用),
     但略過要出聲(service 記 warn),不能靜默少做。 */
  it("版面指到不存在的欄位名 → 略過該欄,不讓整包失敗", async () => {
    const pack = templatePackSchema.parse({
      key: "stale-layout",
      version: "1.0",
      name: "舊版面",
      description: "",
      forms: [
        {
          ref: "a",
          name: `舊版面_${String(Date.now()).slice(-5)}`,
          fields: [{ name: "甲", type: "text" }],
          layout: { 甲: { row: 0, col: 0 }, 已改名的欄: { row: 1, col: 0 } },
        },
      ],
    })
    const res = await templates.apply(tenantA, pack, 1)
    expect(res.formIds).toHaveLength(1)
  })
})

/* ══════════════════════════════════════════════════════════════════
   M6|安裝紀錄

   OQ-TPL-6 裁定 C「先脫鉤,但記錄來源與版本」,而 v1.0 沒落地 ——
   `version` 在 packs.ts 寫了 8 次、reader 為 0。這一組測試就是那個 reader 的守衛。
   ══════════════════════════════════════════════════════════════════ */
describe("M6 安裝紀錄", () => {
  it("套用會留下紀錄,且對得回 ref → 實際 formId", async () => {
    const pack = TEMPLATE_PACKS.find((p) => p.key === "purchase-request")
    if (pack === undefined) throw new Error("找不到 purchase-request")
    const res = await templates.apply(tenantA, pack, undefined, { withRecords: true })

    expect(res.installId).not.toBeNull()
    const list = await installs.list(tenantA, "purchase-request")
    expect(list.length).toBeGreaterThanOrEqual(1)
    const rec = list[0]
    if (rec === undefined) throw new Error("no install record")

    expect(rec.templateKey).toBe("purchase-request")
    expect(rec.version).toBe(pack.version)
    expect(rec.withRecords).toBe(true)
    /* ref → formId 要對得回去,否則更新永遠無法對位 */
    expect(rec.forms.map((f) => f.ref).sort()).toEqual(pack.forms.map((f) => f.ref).sort())
    for (const f of rec.forms) {
      expect(f.formId).toBe(res.refMap[f.ref])
      /* 表還在 → currentName 有值 */
      expect(f.currentName).not.toBeNull()
    }
  })

  it("🔴 跨租戶隔離:B 讀不到 A 的安裝紀錄", async () => {
    const listB = await installs.list(tenantB)
    expect(listB).toHaveLength(0)
    const listA = await installs.list(tenantA)
    expect(listA.length).toBeGreaterThan(0)
  })

  it("同一個範本套第二次 → 兩筆紀錄,不是覆蓋", async () => {
    const pack = TEMPLATE_PACKS.find((p) => p.key === "meeting-notes")
    if (pack === undefined) throw new Error("找不到 meeting-notes")
    /* ⚠️ 本檔前面的「逐包實建」測試已經裝過每一包 —— 測差量,不測絕對值 */
    const before = (await installs.list(tenantA, "meeting-notes")).length
    const r1 = await templates.apply(tenantA, pack)
    const r2 = await templates.apply(tenantA, pack)
    const list = await installs.list(tenantA, "meeting-notes")
    /* M4 已確立「再套一份」是合法意圖(不同部門 / 不同年度),
       所以刻意沒有 (tenant, key) 唯一約束 —— 覆蓋會抹掉安裝史 */
    expect(list).toHaveLength(before + 2)
    /* 兩次裝出來的是不同的表 */
    const ids = new Set([...r1.formIds, ...r2.formIds])
    expect(ids.size).toBe(pack.forms.length * 2)
  })

  it("記的是安裝當下的名字 —— 使用者改名後仍講得出原本是哪一張", async () => {
    const pack = TEMPLATE_PACKS.find((p) => p.key === "customer-directory")
    if (pack === undefined) throw new Error("找不到 customer-directory")
    await templates.apply(tenantA, pack)
    const rec = (await installs.list(tenantA, "customer-directory"))[0]
    if (rec === undefined) throw new Error("no record")
    const f = rec.forms[0]
    if (f === undefined) throw new Error("no form")
    expect(f.installedAs).toBe("客戶名單")
    expect(f.currentName).toBe("客戶名單")
  })

  it("highestVersions 只列裝過的,且沒裝過的不出現", async () => {
    const map = await installs.highestVersions(tenantA)
    expect(map.get("purchase-request")).toBe("1.0")
    /* 沒裝過的租戶身上什麼都沒有 —— 這條同時守住「沒裝 ≠ 有新版」 */
    const mapB = await installs.highestVersions(tenantB)
    expect(mapB.size).toBe(0)
    /* ⚠️ 不能斷言「key 都在 TEMPLATE_PACKS 裡」—— 本檔多數測試用的是**臨時組的 pack**
       (purchase / twice / with-layout …),那些也會留紀錄,而且理當如此。
       真正的守衛是 DB 的 CHECK:key 必須符合 `^[a-z][a-z0-9-]{1,40}$`。 */
    for (const k of map.keys()) expect(k).toMatch(/^[a-z][a-z0-9-]{1,40}$/)
  })
})

/* ══════════════════════════════════════════════════════════════════
   M7|僅新增式更新(OQ-TPL-11 = B)

   唯一的不變量:**只新增,絕不改名、不改型別、不刪除、不碰資料。**
   下面每一條都在守它 —— 這組測試紅了,就是定位出問題,不是功能壞掉。
   ══════════════════════════════════════════════════════════════════ */
describe("M7 僅新增式更新", () => {
  const v1 = templatePackSchema.parse({
    key: "upd-demo",
    version: "1.0",
    name: "更新示範",
    description: "測 M7 用",
    forms: [
      {
        ref: "head",
        name: "更新示範單",
        fields: [
          { name: "單號", type: "text" },
          { name: "會被改名的欄位", type: "text" },
          { name: "v1 才有的欄位", type: "text" },
        ],
      },
    ],
  })
  /* v1.1:加一張表、在既有表加一欄、**拿掉** 一欄(拿掉的絕不能被刪) */
  const v11 = templatePackSchema.parse({
    key: "upd-demo",
    version: "1.1",
    name: "更新示範",
    description: "測 M7 用",
    forms: [
      {
        ref: "head",
        name: "更新示範單",
        fields: [
          { name: "單號", type: "text" },
          { name: "會被改名的欄位", type: "text" },
          { name: "v1.1 新欄位", type: "number" },
        ],
      },
      {
        ref: "child",
        name: "更新示範明細",
        parentRef: "head",
        fields: [{ name: "品名", type: "text" }],
      },
    ],
  })

  let headId = 0

  it("裝 v1.0 → 預覽 v1.1:只列新增,不列任何刪改", async () => {
    const res = await templates.apply(tenantA, v1)
    headId = res.refMap.head ?? 0
    expect(headId).toBeGreaterThan(0)

    const plan = await updates.plan(tenantA, v11)
    expect(plan.fromVersion).toBe("1.0")
    expect(plan.toVersion).toBe("1.1")
    expect(plan.newForms.map((f) => f.ref)).toEqual(["child"])
    expect(plan.newFields).toHaveLength(1)
    expect(plan.newFields[0]?.fields).toEqual(["v1.1 新欄位"])
    expect(plan.nothingToDo).toBe(false)
    /* 🔴 計畫裡沒有「刪除」或「改名」這種東西可表達 —— 型別上就沒有那些欄位。
       這條斷言是活的文件:有人日後加上 removedFields,它會逼他重新想過。 */
    expect(Object.keys(plan)).toEqual(
      expect.arrayContaining(["newForms", "newFields", "skipped", "caveat"]),
    )
    expect(Object.keys(plan)).not.toContain("removedFields")
    expect(Object.keys(plan)).not.toContain("renamedFields")
  })

  it("套用後:新表新欄都在,而 pack 拿掉的舊欄**沒有被刪**", async () => {
    await updates.apply(tenantA, v11)

    const head = await metadata.getForm(tenantA, headId)
    const names = head.fields.map((f) => f.name)
    expect(names).toContain("v1.1 新欄位")
    /* 🔴 不變量:v1.1 的 pack 已經沒有這一欄,但它**必須還在** */
    expect(names).toContain("v1 才有的欄位")
    /* 🔴 既有欄位的型別不能被動過。cellValueType / dbFieldType 都要原封不動 ——
       「更新順便把型別改對」是最容易讓人接受、也最會弄壞資料的一種好意。 */
    const no = head.fields.find((f) => f.name === "單號")
    expect(no?.cellValueType).toBe("text")
    expect(no?.dbFieldType).toBe("text")
    const kept = head.fields.find((f) => f.name === "v1 才有的欄位")
    expect(kept?.deletedAt).toBeNull()

    /* 新表建出來了,而且是 head 的子表 */
    const forms = await metadata.listForms(tenantA)
    const child = forms.find((f) => f.name === "更新示範明細")
    expect(child).toBeDefined()
    expect(child?.parentFormId).toBe(headId)
  })

  it("更新留下 kind='update' 的紀錄,且指回被更新的那一次", async () => {
    const list = await installs.list(tenantA, "upd-demo")
    expect(list).toHaveLength(2)
    const [latest, first] = list
    expect(latest?.kind).toBe("update")
    expect(latest?.version).toBe("1.1")
    expect(latest?.supersedesInstallId).toBe(first?.id)
    expect(first?.kind).toBe("install")
    /* 更新後的那一列要帶**完整**對映,下一次更新才不用回頭追鏈 */
    expect(latest?.forms.map((f) => f.ref).sort()).toEqual(["child", "head"])
  })

  it("已經是最新版 → 拒絕,而不是做一次空更新", async () => {
    await expect(updates.plan(tenantA, v11)).rejects.toThrow(/最新版/)
  })

  it("沒裝過 → 拒絕,並講「請先套用」而不是「沒有新版」", async () => {
    const other = templatePackSchema.parse({
      key: "never-installed",
      version: "2.0",
      name: "沒裝過的",
      description: "x",
      forms: [{ ref: "a", name: "沒裝過的表", fields: [{ name: "x", type: "text" }] }],
    })
    await expect(updates.plan(tenantA, other)).rejects.toThrow(/還沒有安裝過/)
  })

  it("🔴 使用者刪掉的表:列為 skipped,**不重建**", async () => {
    const p1 = templatePackSchema.parse({
      key: "upd-deleted",
      version: "1.0",
      name: "刪表示範",
      description: "x",
      forms: [
        { ref: "a", name: "刪表示範A", fields: [{ name: "x", type: "text" }] },
        { ref: "b", name: "刪表示範B", fields: [{ name: "y", type: "text" }] },
      ],
    })
    const p11 = templatePackSchema.parse({
      ...p1,
      version: "1.1",
      forms: [
        {
          ref: "a",
          name: "刪表示範A",
          fields: [
            { name: "x", type: "text" },
            { name: "新增的", type: "text" },
          ],
        },
        { ref: "b", name: "刪表示範B", fields: [{ name: "y", type: "text" }] },
      ],
    })
    const res = await templates.apply(tenantA, p1)
    const bId = res.refMap.b ?? 0
    await ddl.dropForm(tenantA, bId)

    const plan = await updates.plan(tenantA, p11)
    expect(plan.skipped.map((s) => s.ref)).toContain("b")
    expect(plan.skipped[0]?.reason).toMatch(/已被刪除,不會重建/)
    /* 被刪的表不會出現在「要新建」裡 —— 那才是「重建」 */
    expect(plan.newForms.map((f) => f.ref)).not.toContain("b")

    await updates.apply(tenantA, p11)
    const forms = await metadata.listForms(tenantA)
    expect(forms.filter((f) => f.name === "刪表示範B")).toHaveLength(0)
  })

  it("預覽沒有副作用 —— 連跑三次,表數不變", async () => {
    const before = (await metadata.listForms(tenantA)).length
    const p = templatePackSchema.parse({
      key: "upd-noside",
      version: "1.0",
      name: "無副作用",
      description: "x",
      forms: [{ ref: "a", name: "無副作用表", fields: [{ name: "x", type: "text" }] }],
    })
    await templates.apply(tenantA, p)
    const p11 = templatePackSchema.parse({
      ...p,
      version: "1.1",
      forms: [
        {
          ref: "a",
          name: "無副作用表",
          fields: [
            { name: "x", type: "text" },
            { name: "z", type: "text" },
          ],
        },
      ],
    })
    const after1 = (await metadata.listForms(tenantA)).length
    await updates.plan(tenantA, p11)
    await updates.plan(tenantA, p11)
    await updates.plan(tenantA, p11)
    expect((await metadata.listForms(tenantA)).length).toBe(after1)
    expect(after1).toBe(before + 1)
  })
})
