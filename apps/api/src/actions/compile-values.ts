import { BadRequestException } from "@nestjs/common"

import type { RecordValues } from "@weyver/rules"
import type { ValueSource } from "./action-specs.js"

/* 確定性編譯:值來源封閉列舉(literal / field / variable),**絕不 eval**;未知欄 → 400。

   ## 🔴 為什麼從 `button.service.ts` 搬出來

   事件觸發器(R1·C-4)要用同一套編譯。留在 service 裡的話,觸發器只有兩條路:
   相依整個 `ButtonService`(它相依 `RecordService` → 迴圈風險),或**自己再寫一份**。
   後者的漂移形態是「按鈕設得起來的值,觸發器設不起來」—— 使用者看不出為什麼。

   本檔**刻意是純函式**:不碰 DB、不注入、不知道呼叫者是按鈕還是觸發器。 */
export function compileValues(
  map: Record<string, ValueSource>,
  values: RecordValues,
  actorId: number,
  now: Date = new Date(),
): RecordValues {
  const out: RecordValues = {}
  for (const [target, src] of Object.entries(map)) {
    if (src.from === "literal") {
      out[target] = src.value
    } else if (src.from === "field") {
      if (!(src.field in values)) {
        throw new BadRequestException({
          code: "INVALID_ACTION_CONFIG",
          message: `來源欄不存在:${src.field}`,
        })
      }
      out[target] = values[src.field] ?? null
    } else {
      out[target] =
        src.variable === "$USERID"
          ? actorId
          : src.variable === "$TODAY"
            ? now.toISOString().slice(0, 10)
            : now.toISOString()
    }
  }
  return out
}
