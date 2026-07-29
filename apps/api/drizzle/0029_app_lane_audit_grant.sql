-- 🔴 app 車道對 action_audit 缺 grant(#113 瀏覽器實走時抓到)。
-- 快照帶入的「重整」在**同一個交易**裡改資料 + 寫稽核 —— 分開寫會出現
-- 「資料改了但沒人知道是誰改的」這種最糟的組合,所以稽核必須走同一條連線。
-- 整合測當時用 superuser 車道跑,權限問題整個被遮住(與本 session 稍早
-- 「測試用 superuser 連線導致 RLS 全程未執法」同一類假綠)。
--
-- 只給 SELECT / INSERT:稽核是 append-only,app 車道不得改也不得刪(承 #103)。
GRANT SELECT, INSERT ON public.action_audit TO weyver_app;--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE public.action_audit_id_seq TO weyver_app;
