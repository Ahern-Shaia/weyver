import { Module } from "@nestjs/common"
import { ConfigModule } from "@nestjs/config"
import { APP_FILTER } from "@nestjs/core"
import { validateEnv } from "./config/env.js"
import { DbModule } from "./db/db.module.js"
import { FormEngineModule } from "./form-engine/form-engine.module.js"
import { HealthModule } from "./health/health.module.js"
import { DomainExceptionFilter } from "./http/domain-exception.filter.js"

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    DbModule,
    FormEngineModule,
    HealthModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: DomainExceptionFilter }],
})
export class AppModule {}
