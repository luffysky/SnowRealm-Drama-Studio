-- 編劇已確認的隱藏設定 (Z201).
--
-- 自己一張表，**不是 `episodes` 的一個欄位**。
--
-- 雙視角審核的整個重點是「觀眾那一趟拿不到這些」，而一個長在 `episodes` 上的
-- 欄位會被每一個 `select *`、每一個「順手多撈一欄」帶出去。放在另一張表的意思
-- 是：要拿到它必須**明確地去 join**，而那是一個寫得出來、看得見、審得到的動作。
--
-- **純新增**：沒有任何既有的表或欄位被動到。

CREATE TABLE IF NOT EXISTS "episode_secrets" (
	-- 一集一筆，所以 episode_id 直接當主鍵。
	"episode_id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	/*
	 * 編劇知道、觀眾還不知道的事。
	 *
	 * 例如「梅花印其實是沈家與許家的共營商契，第 28 集才揭曉」——有了這一段，
	 * 編劇視角才判得出第 7 集那個疑問是「刻意留白」還是「真的漏了」。
	 */
	"notes" text DEFAULT '' NOT NULL,
	"updated_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "episode_secrets" ADD CONSTRAINT "episode_secrets_episode_id_episodes_id_fk"
		FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "episode_secrets" ADD CONSTRAINT "episode_secrets_project_id_projects_id_fk"
		FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "episode_secrets" ADD CONSTRAINT "episode_secrets_updated_by_id_users_id_fk"
		FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "episode_secrets_project_idx" ON "episode_secrets" ("project_id");
