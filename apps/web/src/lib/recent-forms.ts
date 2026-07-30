/* R1·UX-1 M4|最近使用的表單(IA 三層防線之第二層)。

   ## 為什麼存在本地而非後端

   後端方案需新表 + 每次開表單一次寫入(熱路徑)。而本地方案在此場景**安全性由建構保證**:
   首頁只保存 formId,渲染時**對照後端已回傳的授權清單解析** —— 那份清單本就是
   tenant-scoped 且經三態可見性過濾。因此跨租戶或越權的 id **比對不到就不會出現**,
   不是靠額外檢查擋下來的。已刪除的表單同理自動消失。

   代價誠實說:**per-device**,換機器就沒有。工廠場景多為固定工作站,可接受。
   若日後要跨裝置(或需要真實使用頻率數據以複核 OQ-1 的設定頁頻率假設),
   再改為後端 `form_access` 表。

   ## 🔴 為什麼 key 一定要帶租戶

   localStorage 跨分頁共用,而分頁可能各自停在不同公司(F-10 的教訓正是如此)。
   key 不帶租戶等於在另一個地方重犯同樣的錯。此處為雙層:key 隔離 + 授權清單解析。

   🔴 **反向驗證實測(2026-07-31)**|把 key 的租戶隔離拿掉後 **e2e 仍然通過** ——
   因為 formId 全域唯一,另一租戶的授權清單本就沒有那個 id,第二層即已濾掉。
   即:**防洩漏由「授權清單解析」單獨成立**;key 隔離是縱深防禦 + 體驗
   (換公司時看到該公司的最近使用,而非一片空白)。
   單元測試直接測 key,拿掉即轉紅 —— 兩層各有測試守著,勿因 e2e 綠而刪任一層。 */

const PREFIX = "weyver.recent."
const LIMIT = 8

function keyFor(scope: string): string {
  return `${PREFIX}${scope}`
}

function read(scope: string): number[] {
  try {
    const raw = window.localStorage.getItem(keyFor(scope))
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((v): v is number => typeof v === "number" && Number.isInteger(v))
  } catch {
    /* 壞掉的 localStorage 內容不該讓首頁掛掉 —— 最近使用是輔助資訊,不是關鍵路徑 */
    return []
  }
}

export function recordFormVisit(scope: string, formId: number): void {
  if (typeof window === "undefined") return
  const next = [formId, ...read(scope).filter((id) => id !== formId)].slice(0, LIMIT)
  try {
    window.localStorage.setItem(keyFor(scope), JSON.stringify(next))
  } catch {
    /* 配額滿或隱私模式 → 放棄記錄即可,不影響任何功能 */
  }
}

export function readRecentFormIds(scope: string): number[] {
  if (typeof window === "undefined") return []
  return read(scope)
}
