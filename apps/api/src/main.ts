import "reflect-metadata"
import { NestFactory } from "@nestjs/core"
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify"
import { AppModule } from "./app.module.js"
import { envSchema } from "./config/env.js"

/* OpenAPI 文件:@nestjs/swagger 依賴 emitDecoratorMetadata(tsx/esbuild 不支援,
   且本專案採顯式 @Inject 不產 paramtypes)→ 改於 P0-5 以 zod-openapi 由既有
   Zod schema 生成(單一 schema 來源,更貼合)。 */
async function bootstrap(): Promise<void> {
  const env = envSchema.parse(process.env)
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter())
  await app.listen({ port: env.PORT, host: "0.0.0.0" })
  console.log(`api listening on :${env.PORT}`)
}

bootstrap().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
