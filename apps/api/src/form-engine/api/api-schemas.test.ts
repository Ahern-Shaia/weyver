import { describe, expect, it } from "vitest"
import type { FieldAccessPolicy } from "../../authz/authz-effective.js"
import type { FormWithFields } from "../metadata/metadata.service.js"
import { toFormDto } from "./api-schemas.js"

/* 🔴 OQ-PC-11 = A 之「設計期擋」(`pivot-and-charts` §14.5b)。

   欄位**值**有 `maskRead` 擋著,但**欄位名稱**原本照回。
   而名稱本身就是業務資訊 —— 「離職原因」「毛利率」「客訴等級」光是存在就說明了一件事。

   受影響的不只圖表軸:設計器 / 篩選面板 / 看板分欄 / 匯出欄位選單,
   凡是列欄位的地方都在列使用者無權看的欄位。而執行期是 fail-closed 的,
   所以使用者**選得到一個必定失敗的軸** —— 那正是 OQ-PC-11 引 Salesforce 時要避免的。 */

const loaded = {
  form: { id: 7, name: "人事", provisionState: "ready", version: 1, parentFormId: null },
  fields: [
    {
      id: 1,
      name: "姓名",
      cellValueType: "text",
      required: false,
      unique: false,
      options: {},
      position: 0,
    },
    {
      id: 2,
      name: "離職原因",
      cellValueType: "text",
      required: false,
      unique: false,
      options: {},
      position: 1,
    },
  ],
} as unknown as FormWithFields

const policy = (hidden: number[]): FieldAccessPolicy => ({
  fieldVisibility: (fieldId) => (hidden.includes(fieldId) ? "hidden" : "read"),
})

describe("toFormDto 之欄位級過濾", () => {
  it("🔴 hidden 的欄位**連名稱都不回** —— 名稱本身就是業務資訊", () => {
    const dto = toFormDto(loaded, policy([2]))
    expect(dto.fields.map((f) => f.name)).toEqual(["姓名"])
  })

  it("可讀的欄位照常回", () => {
    expect(toFormDto(loaded, policy([])).fields).toHaveLength(2)
  })

  /* 未帶 policy 時不過濾 —— dev 路徑與內部呼叫維持既有行為。
     ⚠️ 這是刻意的向後相容,不是漏洞:對外端點一律帶 policy(見 forms.controller)。 */
  it("未帶 policy 時不過濾(既有呼叫端行為不變)", () => {
    expect(toFormDto(loaded).fields).toHaveLength(2)
  })
})
