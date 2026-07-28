import { Global, Module } from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import { ImageProcessor } from "./image-processor.js"
import { LocalStorageDriver } from "./local-storage.driver.js"
import { S3StorageDriver } from "./s3-storage.driver.js"
import { STORAGE_DRIVER, type StorageDriver } from "./storage-driver.js"

/* F-5 儲存驅動注入(@Global:多模組共用同一 infra,承 AGENTS「共用 infra 註冊一次」)。
   env STORAGE_DRIVER 決定實作;prod 選 s3 時缺 key 已於 env superRefine fail-fast(FMEA S8)。 */
@Global()
@Module({
  providers: [
    {
      provide: STORAGE_DRIVER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): StorageDriver => {
        const driver = config.get<string>("STORAGE_DRIVER") ?? "local"
        if (driver === "s3") {
          return new S3StorageDriver({
            bucket: config.get<string>("STORAGE_BUCKET") ?? "",
            region: config.get<string>("STORAGE_REGION") ?? "auto",
            accessKeyId: config.get<string>("STORAGE_ACCESS_KEY") ?? "",
            secretAccessKey: config.get<string>("STORAGE_SECRET_KEY") ?? "",
            endpoint: config.get<string>("STORAGE_ENDPOINT"),
          })
        }
        return new LocalStorageDriver(config.get<string>("STORAGE_LOCAL_DIR") ?? ".weyver-storage")
      },
    },
    ImageProcessor,
  ],
  exports: [STORAGE_DRIVER, ImageProcessor],
})
export class StorageModule {}
