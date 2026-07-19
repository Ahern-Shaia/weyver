-- app 車道角色(鐵則 3 / docs/21):weyver_app 無 DDL、無 BYPASSRLS、不擁有表 → RLS 真正執法。
-- NOLOGIN group role;部署時另建 LOGIN 使用者 GRANT weyver_app TO <login>(測試同法)。
-- 角色為 cluster 級物件:CREATE ROLE 不可 rollback 進 tx?可,但需冪等(多 DB / 重跑)→ DO block guard。

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'weyver_app') THEN
    CREATE ROLE weyver_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA "data" TO weyver_app;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO weyver_app;
--> statement-breakpoint
GRANT SELECT ON public.tenants TO weyver_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.form_def, public.field_def, public.relation_def, public.ddl_audit TO weyver_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO weyver_app;
