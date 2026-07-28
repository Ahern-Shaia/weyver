-- 🔴 簽核歷史 append-only 強制(追溯稽核 #103)
--
-- 動機|21 CFR Part 11 要求 audit trail「不得遮蔽先前記錄」且**連系統管理員都不應能改**;
--       食品廠 ISO 22000 / HACCP 稽核同源。原本只是「約定不去改」,沒有機制保證。
--
-- 為什麼只 REVOKE 不夠|PostgreSQL 官方:**表的 owner 永遠被視為持有全部 grant option**,
--       可隨時把權限 re-grant 回自己;權限沒有 RLS `FORCE` 的等價物。故三層並用。

CREATE OR REPLACE FUNCTION public.deny_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'append-only %.%: % denied (21 CFR 11.10(e))',
    TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS no_mutate ON public.approval_step_log;
--> statement-breakpoint
CREATE TRIGGER no_mutate BEFORE UPDATE OR DELETE ON public.approval_step_log
  FOR EACH ROW EXECUTE FUNCTION public.deny_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS no_truncate ON public.approval_step_log;
--> statement-breakpoint
-- TRUNCATE 只能掛 STATEMENT 級
CREATE TRIGGER no_truncate BEFORE TRUNCATE ON public.approval_step_log
  FOR EACH STATEMENT EXECUTE FUNCTION public.deny_mutation();
--> statement-breakpoint
-- 關鍵:預設 trigger 於 session_replication_role='replica' 會被整批跳過 → 必須 ENABLE ALWAYS
ALTER TABLE public.approval_step_log ENABLE ALWAYS TRIGGER no_mutate;
--> statement-breakpoint
ALTER TABLE public.approval_step_log ENABLE ALWAYS TRIGGER no_truncate;
--> statement-breakpoint
-- app 車道只留 SELECT + INSERT(即使日後誤加 UPDATE grant,trigger 仍會擋)
REVOKE UPDATE, DELETE, TRUNCATE ON public.approval_step_log FROM weyver_app;
--> statement-breakpoint
-- event trigger 擋 DROP(DROP 不是權限,一般 trigger 也擋不到)
CREATE OR REPLACE FUNCTION public.protect_audit_tables() RETURNS event_trigger LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM pg_event_trigger_dropped_objects() LOOP
    IF r.object_identity IN ('public.approval_step_log', 'public.ddl_audit') THEN
      RAISE EXCEPTION 'drop of audit table % blocked', r.object_identity;
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
DROP EVENT TRIGGER IF EXISTS protect_audit_tables;
--> statement-breakpoint
CREATE EVENT TRIGGER protect_audit_tables ON sql_drop
  EXECUTE FUNCTION public.protect_audit_tables();

-- ⚠️ 誠實邊界|superuser 仍可 DISABLE TRIGGER 或丟掉 event trigger。DB 內無法防 superuser ——
--    21 CFR 11 要的是「不遮蔽先前記錄 + 可偵測竄改」,不是宣稱 superuser-proof。
--    偵測層(hash chain + WAL 歸檔到 WORM)列為後續。
