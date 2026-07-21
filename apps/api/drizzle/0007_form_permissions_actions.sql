-- P0-4a M7:表單級由單一 level(none/read/write/manage)→ 動作旗標集 actions text[]
-- (view/create/edit/delete/approve/export/design)。form_permissions 為本 session 新表,無 prod 資料。
ALTER TABLE "form_permissions" DROP CONSTRAINT IF EXISTS "form_permissions_level";--> statement-breakpoint
ALTER TABLE "form_permissions" ADD COLUMN "actions" text[] DEFAULT ARRAY[]::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "form_permissions" DROP COLUMN "level";
