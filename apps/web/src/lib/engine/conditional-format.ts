/* R1·UP-3b|條件式格式求值的**前端入口**。

   🔴 求值本身住在 `@weyver/rules` —— C-3 之後同一個判斷既決定畫面上標不標必填,
   也決定伺服器收不收這筆資料。兩份實作漂移的後果不是樣式不一致,
   而是「畫面說可以存、伺服器說不行」,而使用者看不出自己錯在哪。
   先例是 `@weyver/formula`(見 `formula-preview.ts` 檔頭)。 */
export {
  type ActionGateState,
  evaluateApprovalGate,
  evaluateButtonGate,
  evaluateFieldStates,
  type FieldEffectState,
  evaluateFormats,
  evaluateMessages,
  matchesCondition,
  renderMessage,
  resolveFieldAttrs,
  sectionMembers,
} from "@weyver/rules"
