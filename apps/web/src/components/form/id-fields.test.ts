import { describe, expect, it } from "vitest"

import { CELL_VALUE_TYPES, type CellValueType, type FieldDto } from "@/lib/engine/schemas"
import { formatFieldValue, toSubmitValue } from "./value"

/* 🔴 **指向 id 的欄位型別必須被逐一列進兩支出口**,而漏列型別抓不到。

   ## 為什麼有這一支

   `value.ts` 裡那段註解逐字寫著:

   > 「上面那段註解(#96 member 欄)逐字寫過同一件事,而 link 還是踩了 ——
   >  因為那條規則寫在註解裡,**沒有任何機制在漏列時發出訊號**。
   >  兩次都是**瀏覽器實走**才發現的:單元測試不會送出、型別上 `unknown` 一路綠燈。」

   漏列的後果分兩種,都很難察覺:
   · `toSubmitValue` 漏 → 值**送不出去**(存了等於沒存,而且沒有錯誤)
   · `formatFieldValue` 漏 → 畫面印出**裸數字 id**(58 而不是「王小明」)

   加 `group` 型別時,同一個坑就在正前方 —— 這次連檢查一起做,
   而不是當第三個踩的人(`pitfall_rule_without_check_always_drifts`)。

   ## 判準

   「指向 id」= 值是一個指向別的東西的正整數。目前是 member / group / link。
   新增同類型別時**這一行要一起改**,而漏改會讓下面兩條紅 —— 那就是重點。 */

const ID_TYPES: readonly CellValueType[] = ["member", "group", "link"]

const field = (type: CellValueType): FieldDto => ({
  id: 77,
  name: "指標欄",
  type,
  required: false,
  unique: false,
  options: {},
  position: 0,
})

describe("指向 id 的欄位型別", () => {
  it("ID_TYPES 都還在型別清單裡(型別被移除時這裡先紅)", () => {
    for (const t of ID_TYPES) expect(CELL_VALUE_TYPES).toContain(t)
  })

  it("🔴 `toSubmitValue` 要送得出去 —— 漏列的話值會靜靜地存不進去", () => {
    for (const t of ID_TYPES) {
      expect(toSubmitValue(field(t), 58), `${t} 的值被吞掉了`).toBe(58)
      /* 清空要能表達成 null,而不是 undefined(undefined = 不送這個鍵) */
      expect(toSubmitValue(field(t), null), `${t} 清不掉`).toBeNull()
    }
  })

  it("🔴 `formatFieldValue` 要翻得出名字 —— 漏列的話畫面印裸 id", () => {
    const labels = new Map([["77:58", "業務部"]])
    const members = new Map([[58, "王小明"]])
    for (const t of ID_TYPES) {
      const out = formatFieldValue(field(t), 58, members, undefined, labels)
      expect(out, `${t} 印出了裸 id`).not.toBe("58")
    }
  })

  /* 對照組:沒有對照表時要**看得出那是一個指標**,而不是裝作沒事印個數字。 */
  it("查不到名字時不印裸數字", () => {
    for (const t of ID_TYPES) {
      const out = formatFieldValue(field(t), 999, new Map(), undefined, new Map())
      expect(out, `${t} 在查不到時印了裸 id`).not.toBe("999")
    }
  })
})
