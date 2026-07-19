import { BadRequestException, Injectable, type PipeTransform } from "@nestjs/common"
import { z } from "zod"

/* 邊界驗證單一來源 = Zod(AGENTS ValidationPipe 之等價實作):
   物件 schema 預設 strip 未知鍵(whitelist 行為),驗證失敗 → 400 + 摘要(不回傳輸入內容) */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: z.ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value)
    if (!result.success) {
      throw new BadRequestException({
        code: "VALIDATION_FAILED",
        message: z.prettifyError(result.error),
      })
    }
    return result.data
  }
}
