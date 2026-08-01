import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import { promisify } from "node:util"
import { describe, expect, it } from "vitest"
import { type ExportSource, archiveEntryName, buildArchive } from "./export-archive.js"

/* 🔴 R1·I-1 M1|封存檔產生。

   用**真的 `unzip`** 讀回來驗,不是檢查我方自己的中介資料 ——
   「產出的 zip 別的程式打不開」正是這種模組最典型的失效,而它只有在
   客戶那端才會被發現。 */

const run = promisify(execFile)

const source = (rows: Record<string, unknown>[], pageSize = 2): ExportSource => ({
  readPage: (_formId, cursor) => {
    const start = cursor === null ? 0 : Number(cursor)
    const slice = rows.slice(start, start + pageSize)
    const next = start + pageSize < rows.length ? String(start + pageSize) : null
    return Promise.resolve({ rows: slice, nextCursor: next })
  },
})

const build = async (rows: Record<string, unknown>[], name = "採購單") => {
  const result = await buildArchive({
    tenantName: "鮮勇食品",
    forms: [
      {
        formId: 1,
        name,
        columns: ["品名", "金額"],
        fields: [{ name: "品名", type: "text" }],
      },
    ],
    source: source(rows),
    maxBytes: 10_000_000,
    generatedAt: new Date("2026-08-01T00:00:00.000Z"),
  })
  return result
}

describe("🔴 封存檔", () => {
  it("🔴 是一個真正的 zip,`unzip -l` 讀得到三個成員", async () => {
    const archive = await build([{ id: 1, values: { 品名: "麵粉", 金額: 100 } }])
    try {
      const { stdout } = await run("unzip", ["-l", archive.path])
      expect(stdout).toContain("manifest.json")
      expect(stdout).toContain("README.txt")
      /* 中文檔名在 macOS 內建的 Info-ZIP 6.0 會顯示成亂碼 —— 那是**它**不理會
         UTF-8 旗標,不是我方產錯。故驗旗標本身(見下一條),這裡只數成員。 */
      expect(stdout).toContain(".csv")
    } finally {
      await archive.cleanup()
    }
  })

  /* 🔴 中文表單名的可攜性。客戶是台灣廠商、表單名一定是中文,
     解出來變亂碼就是「檔案打不開」等級的客訴。
     ZIP 規格以 general purpose bit 11(EFS)宣告檔名為 UTF-8;
     Windows 檔案總管與 macOS 內建解壓縮都認這個位元。 */
  it("🔴 檔名以 UTF-8 旗標(EFS bit 11)標記", async () => {
    const archive = await build([{ id: 1, values: {} }])
    try {
      const buf = await readFile(archive.path)
      /* local file header: signature(4) + version(2) + general purpose flags(2) */
      const flags = buf.readUInt16LE(6)
      expect((flags >> 11) & 1).toBe(1)
    } finally {
      await archive.cleanup()
    }
  })

  it("🔴 分頁讀完全部記錄 —— 少一列就是資料遺失", async () => {
    const rows = Array.from({ length: 7 }, (_, i) => ({
      id: i + 1,
      values: { 品名: `品項${String(i)}`, 金額: i },
    }))
    const archive = await build(rows)
    try {
      expect(archive.rowCount).toBe(7)
      const { stdout } = await run("unzip", ["-p", archive.path, "forms/採購單.csv"])
      /* 標題列 + 7 列,末尾一個空行 */
      expect(stdout.trim().split("\r\n")).toHaveLength(8)
      expect(stdout).toContain("品項6")
    } finally {
      await archive.cleanup()
    }
  })

  it("🔴 公式值在產出的檔案裡已被跳脫", async () => {
    const archive = await build([{ id: 1, values: { 品名: "=cmd|'/c calc'!A1", 金額: 1 } }])
    try {
      const { stdout } = await run("unzip", ["-p", archive.path, "forms/採購單.csv"])
      expect(stdout).toContain("'=cmd")
    } finally {
      await archive.cleanup()
    }
  })

  it("manifest 帶欄位定義 —— CSV 丟掉的型別靠它還原", async () => {
    const archive = await build([{ id: 1, values: {} }])
    try {
      const { stdout } = await run("unzip", ["-p", archive.path, "manifest.json"])
      const manifest = JSON.parse(stdout) as {
        forms: { name: string; file: string; fields: { type: string }[] }[]
      }
      expect(manifest.forms[0]?.file).toBe("forms/採購單.csv")
      expect(manifest.forms[0]?.fields[0]?.type).toBe("text")
    } finally {
      await archive.cleanup()
    }
  })

  /* 🔴 超過上限要在**串流過程中**中止。產完才發現太大,代價已經付掉了。 */
  it("🔴 超過大小上限即中止", async () => {
    const rows = Array.from({ length: 500 }, (_, i) => ({
      id: i,
      values: { 品名: "x".repeat(500), 金額: i },
    }))
    await expect(
      buildArchive({
        tenantName: "t",
        forms: [{ formId: 1, name: "大表", columns: ["品名", "金額"], fields: [] }],
        source: source(rows, 50),
        maxBytes: 1_000,
        generatedAt: new Date("2026-08-01T00:00:00.000Z"),
      }),
    ).rejects.toThrow("EXPORT_TOO_LARGE")
  })
})

describe("🔴 表單名 → 檔名", () => {
  it("路徑分隔與保留字元一律換掉 —— 表單名是使用者輸入", () => {
    expect(archiveEntryName("../../etc/passwd", 1, new Set())).toBe("______etc_passwd")
    /* 只剩底線 = 對收件人沒有意義 → 退回可辨識的 form_<id>(原名在 manifest) */
    expect(archiveEntryName("..", 3, new Set())).toBe("form_3")
    expect(archiveEntryName("a/b:c*d?", 2, new Set())).toBe("a_b_c_d_")
  })

  /* 🔴 同名的兩張表在 zip 裡必須是兩個檔。撞名靜默覆蓋 = 整張表的資料消失。 */
  it("🔴 撞名時加 formId,不覆蓋", () => {
    const taken = new Set<string>()
    expect(archiveEntryName("採購單", 1, taken)).toBe("採購單")
    expect(archiveEntryName("採購單", 2, taken)).toBe("採購單_2")
  })

  it("空白 / 全是特殊字元的名字仍產生得出檔名", () => {
    expect(archiveEntryName("   ", 9, new Set())).toBe("form_9")
  })
})
