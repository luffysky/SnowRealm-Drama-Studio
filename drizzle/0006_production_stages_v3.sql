-- 九階段改為 spec v3 §11.2 的固定鍵，並補齊進度契約所需的欄位與稽核表。
--
-- 舊的 stage enum（NOVEL…REVIEW）與新的不是改名關係：新增了 story_planning
-- 與 release，而 IMAGE／VOICE／MUSIC 三個階段合併成單一的 assets。因此這支
-- migration 必須搬資料，不能只改欄位型別。
--
-- 合併會讓三筆舊列對到同一個 (episode_id, 'assets')，和新的唯一索引衝突，
-- 所以搬遷時先依新鍵聚合，取其中最進階的狀態。

CREATE TYPE "public"."production_stage_key" AS ENUM(
  'story_planning', 'novel', 'script', 'storyboard', 'assets',
  'video', 'postproduction', 'review', 'release'
);--> statement-breakpoint

CREATE TYPE "public"."production_stage_status" AS ENUM(
  'not_started', 'in_progress', 'blocked', 'in_review', 'completed'
);--> statement-breakpoint

CREATE TYPE "public"."assignee_type" AS ENUM('USER', 'AI', 'EXTERNAL');--> statement-breakpoint

CREATE TABLE "episode_production_stages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "episode_id" uuid NOT NULL,
  "stage_key" "production_stage_key" NOT NULL,
  "status" "production_stage_status" DEFAULT 'not_started' NOT NULL,
  "progress_percent" integer DEFAULT 0 NOT NULL,
  "assignee_type" "assignee_type",
  "assignee_id" uuid,
  "approved_version_id" uuid,
  "note" text DEFAULT '' NOT NULL,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE "production_progress_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "episode_id" uuid,
  "stage_id" uuid,
  "stage_key" "production_stage_key" NOT NULL,
  "from_status" "production_stage_status",
  "to_status" "production_stage_status" NOT NULL,
  "from_progress" integer,
  "to_progress" integer DEFAULT 0 NOT NULL,
  "actor_id" uuid,
  "actor_type" "assignee_type" DEFAULT 'USER' NOT NULL,
  "reason" text DEFAULT '' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE "production_milestones" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "title" text NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "episode_from" integer,
  "episode_to" integer,
  "stage_key" "production_stage_key",
  "target_date" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "created_by_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE "production_dependencies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "stage_id" uuid NOT NULL,
  "depends_on_stage_id" uuid NOT NULL,
  "note" text DEFAULT '' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "production_dependencies_pair_key" UNIQUE("stage_id","depends_on_stage_id")
);--> statement-breakpoint

-- 搬遷：舊鍵對新鍵，三合一的 assets 取最進階狀態。
-- DONE > BLOCKED > DOING > TODO 的排序用 CASE 表達，避免依賴 enum 的內部順序。
INSERT INTO "episode_production_stages"
  ("project_id", "episode_id", "stage_key", "status", "progress_percent",
   "assignee_id", "note", "started_at", "completed_at", "updated_at")
SELECT
  e."project_id",
  s."episode_id",
  s."new_key"::"production_stage_key",
  s."new_status"::"production_stage_status",
  CASE WHEN s."new_status" = 'completed' THEN 100 ELSE 0 END,
  s."assignee_id",
  COALESCE(s."note", ''),
  s."started_at",
  s."completed_at",
  now()
FROM (
  SELECT
    "episode_id",
    CASE "stage"
      WHEN 'NOVEL'      THEN 'novel'
      WHEN 'SCRIPT'     THEN 'script'
      WHEN 'STORYBOARD' THEN 'storyboard'
      WHEN 'IMAGE'      THEN 'assets'
      WHEN 'VOICE'      THEN 'assets'
      WHEN 'MUSIC'      THEN 'assets'
      WHEN 'VIDEO'      THEN 'video'
      WHEN 'EDIT'       THEN 'postproduction'
      WHEN 'REVIEW'     THEN 'review'
    END AS "new_key",
    -- 合併時取最進階的狀態；阻塞不視為完成。
    (ARRAY['not_started','in_progress','blocked','completed'])[
      MAX(CASE "state"
            WHEN 'TODO'    THEN 1
            WHEN 'DOING'   THEN 2
            WHEN 'BLOCKED' THEN 3
            WHEN 'DONE'    THEN 4
          END)
    ] AS "new_status",
    MIN("assignee_id"::text)::uuid AS "assignee_id",
    string_agg(NULLIF("note", ''), ' / ') AS "note",
    MIN("started_at")   AS "started_at",
    MAX("completed_at") AS "completed_at"
  FROM "episode_stages"
  GROUP BY "episode_id", 2
) AS s
JOIN "episodes" e ON e."id" = s."episode_id";--> statement-breakpoint

-- 補上舊模型沒有的兩個階段：劇情規劃與上架發布。
INSERT INTO "episode_production_stages" ("project_id", "episode_id", "stage_key")
SELECT e."project_id", e."id", k."stage_key"
FROM "episodes" e
CROSS JOIN (
  SELECT unnest(ARRAY['story_planning','release']::"production_stage_key"[]) AS "stage_key"
) k
WHERE NOT EXISTS (
  SELECT 1 FROM "episode_production_stages" p
  WHERE p."episode_id" = e."id" AND p."stage_key" = k."stage_key"
);--> statement-breakpoint

DROP TABLE "episode_stages";--> statement-breakpoint
DROP TYPE "public"."stage";--> statement-breakpoint
DROP TYPE "public"."stage_state";--> statement-breakpoint

ALTER TABLE "episode_production_stages" ADD CONSTRAINT "episode_production_stages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_production_stages" ADD CONSTRAINT "episode_production_stages_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_production_stages" ADD CONSTRAINT "episode_production_stages_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_progress_events" ADD CONSTRAINT "production_progress_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_progress_events" ADD CONSTRAINT "production_progress_events_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_progress_events" ADD CONSTRAINT "production_progress_events_stage_id_episode_production_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."episode_production_stages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_progress_events" ADD CONSTRAINT "production_progress_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_milestones" ADD CONSTRAINT "production_milestones_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_milestones" ADD CONSTRAINT "production_milestones_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_dependencies" ADD CONSTRAINT "production_dependencies_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_dependencies" ADD CONSTRAINT "production_dependencies_stage_id_episode_production_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."episode_production_stages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_dependencies" ADD CONSTRAINT "production_dependencies_depends_on_stage_id_episode_production_stages_id_fk" FOREIGN KEY ("depends_on_stage_id") REFERENCES "public"."episode_production_stages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE UNIQUE INDEX "episode_production_stages_episode_stage_key" ON "episode_production_stages" USING btree ("episode_id","stage_key");--> statement-breakpoint
CREATE INDEX "episode_production_stages_project_idx" ON "episode_production_stages" USING btree ("project_id","stage_key");--> statement-breakpoint
CREATE INDEX "episode_production_stages_episode_idx" ON "episode_production_stages" USING btree ("episode_id");--> statement-breakpoint
CREATE INDEX "episode_production_stages_assignee_idx" ON "episode_production_stages" USING btree ("assignee_id","status");--> statement-breakpoint
CREATE INDEX "production_progress_events_stage_idx" ON "production_progress_events" USING btree ("stage_id","created_at");--> statement-breakpoint
CREATE INDEX "production_progress_events_project_idx" ON "production_progress_events" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "production_milestones_project_idx" ON "production_milestones" USING btree ("project_id","target_date");--> statement-breakpoint
CREATE INDEX "production_dependencies_project_idx" ON "production_dependencies" USING btree ("project_id");
