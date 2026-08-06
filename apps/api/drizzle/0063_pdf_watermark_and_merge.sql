-- R1·後續-2b M2|A3 租戶浮水印 + 附件 PDF 合併。
--
-- ## 浮水印為什麼是**文字**而不是圖片
--
-- Ragic 的 parity 逐字是「浮水印欄位**上傳公司商標等圖案**」(`doc/56`),
-- 而本次只做文字。理由不是偷懶,是站①查出來的事實:
--
-- 🔴 `tenants.logo_file_key` **沒有任何 writer** —— schema 有、`getTenant` 回傳、
-- 前端 schema 也宣告了,但整個 repo 沒有一處寫得進去。也就是說**租戶級資產上傳
-- 這條路根本不存在**,不是「已經有了、浮水印復用一下就好」。
--
-- 補一條租戶資產上傳(`FilesService.upload` 目前綁欄位型別,不吃租戶級資產)
-- 是獨立的一件事,logo 也在等它。故此處只加文字欄,圖片與 logo 一起排殘留 ——
-- 加一個同樣沒有 writer 的 `watermark_file_key` 只是把同一個漂移再犯一次。
ALTER TABLE "tenants" ADD COLUMN "pdf_watermark_text" text;--> statement-breakpoint

-- 台灣單據實務上的浮水印多半就是這幾個字:作廢 / 副本 / 機密 / 樣本。
-- 上限 32 字元:再長在 A4 斜角上就會超出紙寬,而截斷過的浮水印比沒有更糟。
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_watermark_len"
  CHECK ("pdf_watermark_text" IS NULL OR char_length("pdf_watermark_text") BETWEEN 1 AND 32);--> statement-breakpoint

-- 🔴 `tenants` 的 UPDATE 是**欄位級授權**(見 0045),所以**每加一個可改的欄位
-- 都要單獨授權** —— 漏了的話 app 車道會回「permission denied for table tenants」,
-- 而那個訊息完全看不出是少了一欄的授權。
--
-- ⚠️ 這一條是 2026-08-06 在 dev 手測時才發現的,`pdf.integration.test.ts` 當時是綠的
-- —— 因為它把 `APP_DATABASE_URL` 指向 superuser,app 車道其實是特權車道,
-- grant 與 RLS 一律不執法(`pitfall-privileged-lane-masks-security`)。該檔已改用限權角色。
GRANT UPDATE (pdf_watermark_text) ON public.tenants TO weyver_app;--> statement-breakpoint

-- ## 附件合併
--
-- 🔴 **預設關**。合併會把記錄裡的檔案原樣附進單據,而「印一張採購單」與
-- 「把這張單所有附件一起交出去」是兩個不同的意圖 —— 預設開等於在使用者
-- 沒說要的時候多送資料出門。
ALTER TABLE "pdf_job" ADD COLUMN "merge_attachments" boolean DEFAULT false NOT NULL;--> statement-breakpoint

-- 🔴 哪些附件**沒有**併進去,逐檔記原因。
--
-- 靜默略過是本 repo 最常犯的形狀:使用者拿到一份看起來完整的 PDF,
-- 而其中三個附件因為加密 / 過大 / 未掃毒被丟掉,沒有任何地方說。
-- 反過來讓整份工作失敗也不對 —— 單據本身沒問題卻拿不到。
-- 故:照產,但把略過清單留在工作列上,前端一定顯示。
ALTER TABLE "pdf_job" ADD COLUMN "merge_report" jsonb;--> statement-breakpoint

-- worker 走特權車道寫這兩欄,使用者面只 INSERT 得到 merge_attachments。
-- 既有 GRANT 是資料表層級的 SELECT/INSERT,新欄自動涵蓋,不需補授權。
COMMENT ON COLUMN "pdf_job"."merge_report" IS
  '[{name,reason}] —— 未併入的附件與原因,由 worker 寫入';
