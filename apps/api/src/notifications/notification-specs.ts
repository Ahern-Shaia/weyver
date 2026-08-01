/* H-1 通知系統之型別與規則(docs/modules/R1/notifications.md v0.4)。 */

/* 事件碼。**簽核類為關鍵事件**:去抖動時 bypass(OQ-NT-8),
   且 `approval.overdue` 另豁免總開關(裁定 ④)。 */
export const NOTIFICATION_EVENTS = {
  approvalPending: "approval.pending",
  approvalApproved: "approval.approved",
  approvalRejected: "approval.rejected",
  approvalOverdue: "approval.overdue",
  recordCreated: "record.created",
  recordUpdated: "record.updated",
} as const

export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[keyof typeof NOTIFICATION_EVENTS]

/* 訂閱層級(OQ-NT-15)。**數值有序**是刻意的 —— 有序才能比較、才能表達繼承,
   這正是捨棄 Ragic 四個獨立布林開關的主因(4 開關 = 16 組,含無意義組合)。 */
export const LEVEL = {
  muted: 0,
  /* 預設。承 GitHub:「與我相關」是**地板不是開關** —— 要完全不收得刻意選 muted */
  involved: 10,
  involvedPlusNew: 20,
  all: 30,
  custom: 40,
} as const

export type NotificationLevel = (typeof LEVEL)[keyof typeof LEVEL]

export const DEFAULT_LEVEL: NotificationLevel = LEVEL.involved

/* P0 只有 5 檔(研究建議 6 檔,少「只有被提及」)—— @提及需註解功能,Weyver 尚無。
   不做無法運作的檔位(同「不做假開關」原則)。 */
export const LEVEL_VALUES: readonly number[] = [
  LEVEL.muted,
  LEVEL.involved,
  LEVEL.involvedPlusNew,
  LEVEL.all,
  LEVEL.custom,
]

/* 簽核類一律送(不受層級管)—— 層級管的是「資料異動要收多少」,
   而簽核是**指名要你做事**,不是旁觀資訊。承 GitHub:被指派為自動訂閱地板。 */
const APPROVAL_EVENTS: ReadonlySet<string> = new Set([
  NOTIFICATION_EVENTS.approvalPending,
  NOTIFICATION_EVENTS.approvalApproved,
  NOTIFICATION_EVENTS.approvalRejected,
  NOTIFICATION_EVENTS.approvalOverdue,
])

export function isApprovalEvent(event: string): boolean {
  return APPROVAL_EVENTS.has(event)
}

/* 逾期為總開關之唯一例外(裁定 ④:流程無限期卡住的風險高於使用者意願)。
 **設定頁必須明白告知** —— 靜默的例外會讓使用者以為設定壞了。 */
export function bypassesMasterSwitch(event: string): boolean {
  return event === NOTIFICATION_EVENTS.approvalOverdue
}

/* 依層級判定某事件是否該送給某人。
   `involved` = 此人與該記錄相關(P0 僅認 createdBy;member 欄與註解到位後為純加法擴充)。 */
export function levelAllows(
  level: number,
  event: string,
  involved: boolean,
  customEvents: readonly string[] | null,
): boolean {
  if (isApprovalEvent(event)) return true
  if (level === LEVEL.muted) return false
  if (level === LEVEL.all) return true
  if (level === LEVEL.custom) {
    /* GitLab 式:custom = 「與我相關」之上**加選**,保持有序而非自由組合 */
    return involved || (customEvents ?? []).includes(event)
  }
  if (level === LEVEL.involvedPlusNew) {
    return involved || event === NOTIFICATION_EVENTS.recordCreated
  }
  return involved
}

/* FMEA N14|**標題不得直接取 fields[0]**。
   首欄是使用者自建的任意欄位 —— 客戶把「金額」或「身分證字號」放第一欄,
   通知標題就是洩漏。且欄位級權限使業界主流的「過濾收件人」在此模型下失效(OQ-NT-9)。

   P0 採最保守解:**只用表單名 + 記錄編號**,不碰任何使用者資料欄。
   日後若要更好讀,須走「表單設計者明指通知標題欄 + 設定時警示其內容會外流」。 */
export function safeTitle(formName: string, recordId: number | null): string {
  return recordId === null ? formName : `${formName} #${recordId}`
}
