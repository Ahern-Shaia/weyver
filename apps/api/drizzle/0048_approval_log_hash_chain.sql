-- 🔴 簽核歷史 hash chain(OQ-AP2-9 = B)—— 0021 明列的「偵測層」。
--
-- 0021 已經做完**防護層**:no_mutate / no_truncate trigger(ENABLE ALWAYS)、
-- REVOKE UPDATE/DELETE、event trigger 擋 DROP。它自己在結尾寫著:
--   「⚠️ 誠實邊界|superuser 仍可 DISABLE TRIGGER 或丟掉 event trigger。
--     DB 內無法防 superuser —— 21 CFR 11 要的是「不遮蔽先前記錄 + **可偵測竄改**」,
--     不是宣稱 superuser-proof。偵測層(hash chain + WAL 歸檔到 WORM)列為後續。」
-- 這份 migration 就是那個後續的前半。
--
-- 先例|Odoo 的會計分錄不可竄改機制(官方 18.0 文件):
--   「The previous entry's hash is always added to the next entry to form a hash chain.
--     This is used to ensure a new entry is not added afterward between two posted entries,
--     as doing so would break the hash chain.」
-- 它同時提供**檢查報告**讓稽核者自行驗證鏈有沒有斷 —— 對食品廠 ISO 22000 稽核,
-- 「你怎麼證明這份簽核紀錄沒被動過」正是會被問到的問題。只有寫入端防護答不出來。
--
-- 為什麼用 PG 16 內建 sha256() 而不是 pgcrypto|少一個擴充就少一個 prod 環境的變數
-- (Cloud SQL 上每個擴充都要確認支援;內建函式沒有這個問題)。

ALTER TABLE "approval_step_log" ADD COLUMN IF NOT EXISTS "prev_hash" text;--> statement-breakpoint
ALTER TABLE "approval_step_log" ADD COLUMN IF NOT EXISTS "hash" text;--> statement-breakpoint

-- 🔴 雜湊算式**只有這一份**。trigger 與驗證器都呼叫它 ——
-- 兩邊各寫一次的話,它們遲早分岔,而分岔的表現是「稽核報告說鏈斷了」這種最難查的假警報。
--
-- 時間戳以**微秒 epoch** 入雜湊,不用 ::text:後者的輸出隨 session TimeZone 變,
-- 換個時區驗證同一列會得到不同雜湊。
CREATE OR REPLACE FUNCTION public.approval_log_hash(
  p_prev text, p_tenant bigint, p_instance bigint, p_step int, p_actor bigint,
  p_obo bigint, p_decision text, p_comment text, p_at timestamptz
) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(
    coalesce(p_prev, '')            || '|' ||
    p_tenant::text                  || '|' ||
    p_instance::text                || '|' ||
    p_step::text                    || '|' ||
    p_actor::text                   || '|' ||
    coalesce(p_obo::text, '')       || '|' ||
    p_decision                      || '|' ||
    coalesce(p_comment, '')         || '|' ||
    ((extract(epoch from p_at) * 1000000)::bigint)::text
  , 'UTF8')), 'hex')
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.approval_log_chain() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prev text;
BEGIN
  /* 同一個簽核實例的兩筆 log 若同時插入,兩者會讀到同一個 prev → 鏈分岔。
     會簽(N-of-M)一關多人同時按核准正是這個情境,所以這不是理論風險。
     交易範圍 advisory lock 序列化;key 加大偏移量避開 DDL 用的 formId 鍵空間。 */
  PERFORM pg_advisory_xact_lock(909005000000 + NEW.instance_id);

  SELECT l.hash INTO prev FROM public.approval_step_log l
    WHERE l.instance_id = NEW.instance_id ORDER BY l.id DESC LIMIT 1;

  NEW.prev_hash := prev;
  NEW.hash := public.approval_log_hash(
    prev, NEW.tenant_id, NEW.instance_id, NEW.step_no, NEW.actor_id,
    NEW.on_behalf_of_actor_id, NEW.decision, NEW.comment, NEW.created_at
  );
  RETURN NEW;
END $$;--> statement-breakpoint

DROP TRIGGER IF EXISTS chain_hash ON public.approval_step_log;--> statement-breakpoint
CREATE TRIGGER chain_hash BEFORE INSERT ON public.approval_step_log
  FOR EACH ROW EXECUTE FUNCTION public.approval_log_chain();--> statement-breakpoint
-- 同 0021:預設 trigger 於 session_replication_role='replica' 會被整批跳過
ALTER TABLE public.approval_step_log ENABLE ALWAYS TRIGGER chain_hash;--> statement-breakpoint

-- 🔴 稽核用的鏈完整性檢查。**只讀**,回傳斷點而不是「通過/不通過」——
-- 稽核者要的是「哪一筆、什麼時候、斷在哪」,一個布林值答不了那個問題。
--
-- `reason` 三分,因為三者的意義完全不同:
--   preChain  = 這列早於 hash chain 上線(0048 之前寫的),不是竄改
--   tampered  = 內容與自己的雜湊對不上 → 這一列被改過
--   unlinked  = 自己的雜湊沒問題,但 prev_hash 接不上前一列 → 中間有列被刪掉或插入
CREATE OR REPLACE FUNCTION public.approval_log_chain_breaks(p_tenant bigint)
RETURNS TABLE (log_id bigint, instance_id bigint, step_no int, created_at timestamptz, reason text)
LANGUAGE sql STABLE AS $$
  WITH chained AS (
    SELECT l.*, lag(l.hash) OVER (PARTITION BY l.instance_id ORDER BY l.id) AS expected_prev
      FROM public.approval_step_log l
     WHERE l.tenant_id = p_tenant
  )
  SELECT c.id, c.instance_id, c.step_no, c.created_at,
         CASE
           WHEN c.hash IS NULL THEN 'preChain'
           WHEN c.hash <> public.approval_log_hash(
                  c.prev_hash, c.tenant_id, c.instance_id, c.step_no, c.actor_id,
                  c.on_behalf_of_actor_id, c.decision, c.comment, c.created_at)
             THEN 'tampered'
           WHEN c.prev_hash IS DISTINCT FROM c.expected_prev THEN 'unlinked'
           ELSE NULL
         END AS reason
    FROM chained c
   WHERE c.hash IS NULL
      OR c.hash <> public.approval_log_hash(
           c.prev_hash, c.tenant_id, c.instance_id, c.step_no, c.actor_id,
           c.on_behalf_of_actor_id, c.decision, c.comment, c.created_at)
      OR c.prev_hash IS DISTINCT FROM c.expected_prev
   ORDER BY c.instance_id, c.id
$$;--> statement-breakpoint

-- 檢查報告要讀得到雜湊欄;寫入仍由 trigger 產生,app 車道改不動(0021 已 REVOKE UPDATE)
GRANT EXECUTE ON FUNCTION public.approval_log_chain_breaks(bigint) TO weyver_app;
