import "reflect-metadata"
import { NestFactory } from "@nestjs/core"
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify"
import { AppModule } from "./app.module.js"
import { envSchema } from "./config/env.js"

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
