import { Module } from "@nestjs/common"
import { ConfigModule } from "@nestjs/config"
import { validateEnv } from "./config/env.js"
import { DbModule } from "./db/db.module.js"
import { FormEngineModule } from "./form-engine/form-engine.module.js"
import { HealthModule } from "./health/health.module.js"

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    DbModule,
    FormEngineModule,
    HealthModule,
  ],
})
export class AppModule {}
