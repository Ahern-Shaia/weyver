CREATE TABLE "email_suppression" (
	"email" text PRIMARY KEY NOT NULL,
	"reason" text NOT NULL,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "email_suppression_reason_idx" ON "email_suppression" USING btree ("reason");--> statement-breakpoint
-- 信譽為平台層資產,跨租戶共用 → 不設 RLS;只有背景寄送者(特權車道)讀寫。
-- app 車道刻意**不授權**:租戶不應能讀取或竄改其他租戶造成的抑制記錄。
