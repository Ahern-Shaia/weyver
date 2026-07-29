ALTER TABLE "form_permissions" ADD COLUMN "scoped_actions" text[] DEFAULT ARRAY[]::text[] NOT NULL;--> statement-breakpoint
-- 🔴 E-1 記錄範圍:既有動態表補上 assignees 欄 + GIN + RESTRICTIVE policy(#96 M1)。
-- 新表由 DdlService.rlsStatements 一併建立;此處補既有表,否則「只有新表受保護」。
DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'data' AND tablename ~ '^t[0-9]+$'
  LOOP
    EXECUTE format('ALTER TABLE data.%I ADD COLUMN IF NOT EXISTS assignees bigint[]', t.tablename);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON data.%I USING gin (assignees)',
      t.tablename || '_assignees_gin', t.tablename);
    -- policy 無 IF NOT EXISTS,先 DROP 再建以保證冪等
    EXECUTE format('DROP POLICY IF EXISTS record_scope ON data.%I', t.tablename);
    EXECUTE format(
      'CREATE POLICY record_scope ON data.%I AS RESTRICTIVE USING ('
      || 'COALESCE(NULLIF(current_setting(''app.record_scope'', true), ''''), ''all'') <> ''own'''
      || ' OR created_by = NULLIF(current_setting(''app.actor_id'', true), '''')::bigint'
      || ' OR assignees @> ARRAY[NULLIF(current_setting(''app.actor_id'', true), '''')::bigint])',
      t.tablename);
  END LOOP;
END $$;
