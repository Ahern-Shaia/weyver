import "reflect-metadata"
import { NestFactory } from "@nestjs/core"
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify"
import { configureApp } from "./app-setup.js"
import { AppModule } from "./app.module.js"
import { envSchema } from "./config/env.js"
import { RedactingLogger } from "./http/log-redact.js"

/* OpenAPI 文件:@nestjs/swagger 依賴 emitDecoratorMetadata(tsx/esbuild 不支援,
   且本專案採顯式 @Inject 不產 paramtypes)→ 改於 P0-5 以 zod-openapi 由既有
   Zod schema 生成(單一 schema 來源,更貼合)。 */
async function bootstrap(): Promise<void> {
  const env = envSchema.parse(process.env)
  /* 🔴 全域 logger 掛遮蔽層(A-1 FMEA C1)。**在 create 時就給**,
     不是事後 `useLogger` —— 否則啟動期(模組初始化、DB 自檢)的日誌不受保護,
     而那正是最容易把連線字串印出來的階段。 */
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    logger: new RedactingLogger(),
  })
  await configureApp(app)
  await app.listen({ port: env.PORT, host: "0.0.0.0" })
  console.log(`api listening on :${env.PORT}`)
}

bootstrap().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
