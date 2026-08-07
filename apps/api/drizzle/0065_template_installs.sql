-- R1·TPL M6|安裝紀錄。
--
-- ## 這不是新功能,是把已裁定的東西補上
--
-- `form-templates.md` OQ-TPL-6 裁定 **C:「先脫鉤,但記錄來源與版本」**,逐字寫著
-- 「C 只是多存 `template_key + version + appliedAt`,**成本近零而選項留著**」,
-- 並標註「⚠️ **這是『現在不記以後補不回來』的那種決定**」。
--
-- 🔴 **裁定了,但 v1.0 沒有落地。** `version` 欄位在 `packs.ts` 寫了 8 次、
-- 全庫 **reader 為 0**,也沒有任何「這個租戶裝過哪些 pack」的表。
-- 正是 `pitfall-unread-schema-field-drift`:沒有 reader 的 schema 欄位 = 沉默的規格漂移。
--
-- ## 為什麼是兩張表而不是一個 JSONB 欄位
--
-- 直覺會把 `[{ref, formId}]` 塞成 JSONB。本 repo 有記錄過相反的教訓:
-- `pitfall-serialized-column-breaks-whole-list` ——「嚴格 schema 的序列化欄位一壞炸整個 list」。
-- 安裝紀錄要出現在範本庫每一次列表查詢裡,**一列壞掉不該讓整個範本庫打不開**。
-- 拆成子表則是真欄位,壞不了。

CREATE TABLE "template_installs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "template_installs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"tenant_id" bigint NOT NULL,
	"template_key" text NOT NULL,
	-- 安裝當下的 pack 版本。**這一欄就是 OQ-TPL-6 說「以後補不回來」的那一欄。**
	"version" text NOT NULL,
	-- 當時有沒有一併帶範例資料(OQ-TPL-4)。事後要清資料時得知道原本帶了沒。
	"with_records" boolean DEFAULT false NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_by" bigint,
	-- 🔴 **刻意不設 (tenant_id, template_key) 唯一。**
	-- M4 實走已確立「同一個範本套第二次」是合法意圖(不同部門 / 不同年度),
	-- 撞名時自動加序號並回報。唯一約束會把那條路堵死。
	CONSTRAINT "template_installs_key_shape" CHECK ("template_key" ~ '^[a-z][a-z0-9-]{1,40}$')
);
--> statement-breakpoint

ALTER TABLE "template_installs" ADD CONSTRAINT "template_installs_tenant_id_tenants_id_fk"
	FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "template_installs_tenant_key_idx" ON "template_installs" USING btree ("tenant_id", "template_key");--> statement-breakpoint

ALTER TABLE "template_installs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "template_installs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "template_installs_tenant" ON "template_installs"
	USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
	WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);
--> statement-breakpoint

-- 沒有 UPDATE:安裝發生過就是發生過。要記「後來更新到 v1.1」是**再插一列**,
-- 不是改寫舊列 —— 與傳票不可變同一條原則,而且保住了「這個租戶的安裝史」。
GRANT SELECT, INSERT, DELETE ON public.template_installs TO weyver_app;--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE public.template_installs_id_seq TO weyver_app;--> statement-breakpoint

-- ## 裝出來的是哪幾張表
--
-- 這張子表是「更新」能不能對位的前提:更新要知道 pack 裡的 `ref` 對到租戶的哪個 formId。
-- 沒有它,更新就只能靠**表單名**去猜 —— 而使用者改名是我們明文允許的
-- (Ragic `doc-kb/204` 也允許,只是會計入客製化額度)。
CREATE TABLE "template_install_forms" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "template_install_forms_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"install_id" bigint NOT NULL,
	-- RLS 是逐表的,子表要有自己的 tenant_id 才受管。
	"tenant_id" bigint NOT NULL,
	-- pack 內的相對代號(OQ-TPL-2=A)。更新時用它對位,不用表單名。
	"ref" text NOT NULL,
	-- 🔴 可為 NULL:表被硬清出回收桶時 FK 會把它設成 NULL。
	-- 那正是我們要顯示的狀態(「這張表已經不在了」),不是要避免的狀態。
	"form_id" bigint,
	-- 安裝當下的表名。form_id 變 NULL 之後,這一欄是唯一還講得出「那是哪一張」的東西。
	"form_name" text NOT NULL
);
--> statement-breakpoint

ALTER TABLE "template_install_forms" ADD CONSTRAINT "template_install_forms_install_id_fk"
	FOREIGN KEY ("install_id") REFERENCES "public"."template_installs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_install_forms" ADD CONSTRAINT "template_install_forms_tenant_id_tenants_id_fk"
	FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_install_forms" ADD CONSTRAINT "template_install_forms_form_id_fk"
	FOREIGN KEY ("form_id") REFERENCES "public"."form_def"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

CREATE UNIQUE INDEX "template_install_forms_install_ref_uq" ON "template_install_forms" USING btree ("install_id", "ref");--> statement-breakpoint
CREATE INDEX "template_install_forms_tenant_idx" ON "template_install_forms" USING btree ("tenant_id");--> statement-breakpoint

ALTER TABLE "template_install_forms" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "template_install_forms" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "template_install_forms_tenant" ON "template_install_forms"
	USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
	WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);
--> statement-breakpoint

GRANT SELECT, INSERT, DELETE ON public.template_install_forms TO weyver_app;--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE public.template_install_forms_id_seq TO weyver_app;
