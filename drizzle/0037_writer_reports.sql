-- 編劇助手的整理可以存起來 (Z200).
--
-- 在這之前它跑出來的東西只活在那個分頁裡：重新整理就沒了，而每跑一次都是一次
-- 新的花費。老闆要的是「存好、隨時點開看」。
--
-- **純新增**：沒有任何既有的表或欄位被動到，所以可以先跑遷移再部署。

CREATE TABLE IF NOT EXISTS "writer_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	-- 逐集的那一種才有；主線整理與問答是 null。
	"episode_id" uuid,
	/*
	 * `kind` 是 text 不是 enum (Z184 的教訓)。
	 *
	 * pg 的 enum 加了就刪不掉（沒有 DROP VALUE），而這一欄之後很可能會多出
	 * 「伏筆追蹤」「跨集連貫」之類的種類。合法值由應用程式把關。
	 * 目前：DIGEST（主線與人設）／EPISODE（逐集）／ASK（問答）。
	 */
	"kind" text NOT NULL,
	-- 列表上顯示的那一行，存下來就不用為了畫一個清單去解整包 JSON。
	"title" text DEFAULT '' NOT NULL,
	-- 整包結果，形狀依 kind 而定（見 src/lib/ai/story-audit-view.ts）。
	"payload" jsonb NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "writer_reports" ADD CONSTRAINT "writer_reports_project_id_projects_id_fk"
		FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- 集數被刪掉的時候留著這份整理，只是不再指向任何一集：那份整理講的事情仍然
-- 發生過，而把它一起刪掉等於把歷史也刪掉。
DO $$ BEGIN
	ALTER TABLE "writer_reports" ADD CONSTRAINT "writer_reports_episode_id_episodes_id_fk"
		FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "writer_reports" ADD CONSTRAINT "writer_reports_created_by_id_users_id_fk"
		FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- 列表是「這個作品，最新的在前面」。
CREATE INDEX IF NOT EXISTS "writer_reports_project_idx" ON "writer_reports" ("project_id","created_at" DESC);
