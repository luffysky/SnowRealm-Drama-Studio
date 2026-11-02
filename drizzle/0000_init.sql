CREATE TYPE "public"."ai_job_kind" AS ENUM('PROJECT_PLAN', 'NOVEL_CONTINUE', 'NOVEL_REWRITE', 'NOVEL_POLISH', 'NOVEL_REVIEW', 'NOVEL_TO_SCRIPT', 'SCRIPT_ANALYZE', 'WORLD_GENERATE', 'WORLD_CONSISTENCY', 'CHARACTER_DESIGN', 'STORYBOARD_GENERATE', 'ASSET_GENERATE', 'TASK_SUGGEST');--> statement-breakpoint
CREATE TYPE "public"."ai_job_status" AS ENUM('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'AWAITING_REVIEW');--> statement-breakpoint
CREATE TYPE "public"."ai_provider_kind" AS ENUM('ANTHROPIC', 'IMAGE_GENERIC', 'VIDEO_GENERIC', 'TTS_GENERIC');--> statement-breakpoint
CREATE TYPE "public"."asset_kind" AS ENUM('IMAGE', 'VIDEO', 'MUSIC', 'VOICE', 'SFX', 'NOVEL_ATTACHMENT', 'STICKER', 'DOC', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."camera_move" AS ENUM('STATIC', 'PAN', 'TILT', 'DOLLY_IN', 'DOLLY_OUT', 'TRACKING', 'CRANE', 'HANDHELD', 'ZOOM');--> statement-breakpoint
CREATE TYPE "public"."character_tier" AS ENUM('LEAD', 'SUPPORTING', 'MINOR', 'EXTRA');--> statement-breakpoint
CREATE TYPE "public"."document_kind" AS ENUM('NOVEL', 'SCRIPT');--> statement-breakpoint
CREATE TYPE "public"."episode_status" AS ENUM('PLANNED', 'WRITING', 'STORYBOARD', 'PRODUCTION', 'REVIEW', 'DONE', 'ON_HOLD');--> statement-breakpoint
CREATE TYPE "public"."expense_category" AS ENUM('AI_API', 'SOFTWARE', 'OUTSOURCING', 'VOICE_TALENT', 'MUSIC_LICENSE', 'STOCK_FOOTAGE', 'HARDWARE', 'MARKETING', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."export_kind" AS ENUM('NOVEL', 'SCRIPT', 'STORYBOARD', 'COST_REPORT');--> statement-breakpoint
CREATE TYPE "public"."export_status" AS ENUM('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('PLANNING', 'IN_PRODUCTION', 'PAUSED', 'COMPLETED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."review_state" AS ENUM('OPEN', 'CHANGES_REQUESTED', 'RESOLVED', 'APPROVED');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('OWNER', 'COLLABORATOR');--> statement-breakpoint
CREATE TYPE "public"."shot_size" AS ENUM('EWS', 'WS', 'FS', 'MS', 'MCU', 'CU', 'ECU', 'INSERT');--> statement-breakpoint
CREATE TYPE "public"."shot_status" AS ENUM('TODO', 'PROMPT_READY', 'IMAGE_DONE', 'VIDEO_DONE', 'VOICE_DONE', 'APPROVED', 'RETAKE');--> statement-breakpoint
CREATE TYPE "public"."stage" AS ENUM('NOVEL', 'SCRIPT', 'STORYBOARD', 'IMAGE', 'VIDEO', 'VOICE', 'MUSIC', 'EDIT', 'REVIEW');--> statement-breakpoint
CREATE TYPE "public"."stage_state" AS ENUM('TODO', 'DOING', 'BLOCKED', 'DONE');--> statement-breakpoint
CREATE TYPE "public"."task_priority" AS ENUM('LOW', 'NORMAL', 'HIGH', 'URGENT');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('BACKLOG', 'TODO', 'DOING', 'REVIEW', 'DONE');--> statement-breakpoint
CREATE TYPE "public"."upload_status" AS ENUM('PENDING', 'UPLOADING', 'COMPLETED', 'FAILED', 'ABORTED');--> statement-breakpoint
CREATE TYPE "public"."version_target" AS ENUM('DOCUMENT', 'SHOT', 'CHARACTER', 'WORLD_ENTRY', 'ASSET');--> statement-breakpoint
CREATE TYPE "public"."world_category" AS ENUM('DYNASTY', 'GEOGRAPHY', 'TRADE_ROUTE', 'INSTITUTION', 'CURRENCY', 'TIME_TRAVEL_RULE', 'FORESHADOWING', 'CUISINE', 'OTHER');--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"user_agent" text DEFAULT '' NOT NULL,
	"ip_address" text DEFAULT '' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"password_hash" text NOT NULL,
	"role" "role" DEFAULT 'OWNER' NOT NULL,
	"color" text DEFAULT '#a78bfa' NOT NULL,
	"avatar_asset_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "arcs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"index" integer NOT NULL,
	"title" text NOT NULL,
	"logline" text DEFAULT '' NOT NULL,
	"synopsis" text DEFAULT '' NOT NULL,
	"planned_episodes" integer DEFAULT 120 NOT NULL,
	"cover_asset_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "arcs_project_index_key" UNIQUE("project_id","index")
);
--> statement-breakpoint
CREATE TABLE "episodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"arc_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"logline" text DEFAULT '' NOT NULL,
	"synopsis" text DEFAULT '' NOT NULL,
	"target_sec" integer DEFAULT 150 NOT NULL,
	"status" "episode_status" DEFAULT 'PLANNED' NOT NULL,
	"due_date" timestamp with time zone,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "episodes_arc_number_key" UNIQUE("arc_id","number")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"logline" text DEFAULT '' NOT NULL,
	"synopsis" text DEFAULT '' NOT NULL,
	"genre" text DEFAULT '' NOT NULL,
	"status" "project_status" DEFAULT 'PLANNING' NOT NULL,
	"cover_asset_id" uuid,
	"target_min_sec" integer DEFAULT 120 NOT NULL,
	"target_max_sec" integer DEFAULT 180 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "asset_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"slot" text DEFAULT '' NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_links_unique" UNIQUE("asset_id","entity_type","entity_id","slot")
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"episode_id" uuid,
	"kind" "asset_kind" NOT NULL,
	"name" text NOT NULL,
	"object_key" text NOT NULL,
	"mime_type" text DEFAULT '' NOT NULL,
	"size_bytes" bigint DEFAULT 0 NOT NULL,
	"duration_sec" integer,
	"width" integer,
	"height" integer,
	"checksum" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"root_asset_id" uuid,
	"upload_status" "upload_status" DEFAULT 'PENDING' NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"license" text DEFAULT '' NOT NULL,
	"generation_meta" jsonb,
	"uploaded_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assets_object_key_unique" UNIQUE("object_key")
);
--> statement-breakpoint
CREATE TABLE "upload_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"object_key" text NOT NULL,
	"multipart_upload_id" text,
	"total_bytes" bigint DEFAULT 0 NOT NULL,
	"uploaded_bytes" bigint DEFAULT 0 NOT NULL,
	"part_size_bytes" integer DEFAULT 0 NOT NULL,
	"total_parts" integer DEFAULT 1 NOT NULL,
	"completed_parts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "upload_status" DEFAULT 'PENDING' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error" text DEFAULT '' NOT NULL,
	"created_by_id" uuid,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chapters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"sort_order" integer NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"char_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"episode_id" uuid NOT NULL,
	"kind" "document_kind" NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"char_count" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"approved_version_id" uuid,
	"last_editor_id" uuid,
	"lock_revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_episode_kind_key" UNIQUE("episode_id","kind")
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"document_id" uuid,
	"version_id" uuid,
	"state" "review_state" DEFAULT 'OPEN' NOT NULL,
	"anchor_start" integer,
	"anchor_end" integer,
	"anchor_text" text DEFAULT '' NOT NULL,
	"body" text NOT NULL,
	"author_id" uuid,
	"resolved_by_id" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scenes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"sort_order" integer NOT NULL,
	"code" text DEFAULT '' NOT NULL,
	"heading" text DEFAULT '' NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"time_of_day" text DEFAULT '' NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"estimated_sec" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_type" "version_target" NOT NULL,
	"target_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"char_count" integer DEFAULT 0 NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"restored_from_version_id" uuid,
	"ai_job_id" uuid,
	"is_approved" boolean DEFAULT false NOT NULL,
	"author_id" uuid,
	"author_name" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "versions_target_version_key" UNIQUE("target_type","target_id","version")
);
--> statement-breakpoint
CREATE TABLE "character_relationships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"from_character_id" uuid NOT NULL,
	"to_character_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"sentiment" integer DEFAULT 0 NOT NULL,
	"from_episode_number" integer,
	"to_episode_number" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "characters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"alias" text DEFAULT '' NOT NULL,
	"tier" character_tier DEFAULT 'SUPPORTING' NOT NULL,
	"age" text DEFAULT '' NOT NULL,
	"gender" text DEFAULT '' NOT NULL,
	"appearance" text DEFAULT '' NOT NULL,
	"personality" text DEFAULT '' NOT NULL,
	"background" text DEFAULT '' NOT NULL,
	"growth" text DEFAULT '' NOT NULL,
	"visual_prompt" text DEFAULT '' NOT NULL,
	"negative_prompt" text DEFAULT '' NOT NULL,
	"voice_provider" text DEFAULT '' NOT NULL,
	"voice_id" text DEFAULT '' NOT NULL,
	"voice_style" text DEFAULT '' NOT NULL,
	"voice_note" text DEFAULT '' NOT NULL,
	"key_visual_asset_id" uuid,
	"voice_sample_asset_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "characters_project_name_key" UNIQUE("project_id","name")
);
--> statement-breakpoint
CREATE TABLE "episode_characters" (
	"episode_id" uuid NOT NULL,
	"character_id" uuid NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	CONSTRAINT "episode_characters_episode_id_character_id_pk" PRIMARY KEY("episode_id","character_id")
);
--> statement-breakpoint
CREATE TABLE "world_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"category" "world_category" DEFAULT 'OTHER' NOT NULL,
	"title" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"is_canon" boolean DEFAULT true NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"related_ids" uuid[] DEFAULT '{}' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "world_entries_project_title_key" UNIQUE("project_id","title")
);
--> statement-breakpoint
CREATE TABLE "shots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"episode_id" uuid NOT NULL,
	"scene_id" uuid,
	"order" integer NOT NULL,
	"scene_code" text DEFAULT '' NOT NULL,
	"duration_sec" integer DEFAULT 5 NOT NULL,
	"shot_size" "shot_size" DEFAULT 'MS' NOT NULL,
	"camera" "camera_move" DEFAULT 'STATIC' NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"time_of_day" text DEFAULT '' NOT NULL,
	"action" text DEFAULT '' NOT NULL,
	"dialogue" text DEFAULT '' NOT NULL,
	"speaker_id" uuid,
	"prompt" text DEFAULT '' NOT NULL,
	"negative_prompt" text DEFAULT '' NOT NULL,
	"first_frame_asset_id" uuid,
	"last_frame_asset_id" uuid,
	"ref_asset_id" uuid,
	"image_asset_id" uuid,
	"video_asset_id" uuid,
	"voice_asset_id" uuid,
	"status" "shot_status" DEFAULT 'TODO' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shots_episode_order_key" UNIQUE("episode_id","order")
);
--> statement-breakpoint
CREATE TABLE "episode_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"episode_id" uuid NOT NULL,
	"stage" "stage" NOT NULL,
	"state" "stage_state" DEFAULT 'TODO' NOT NULL,
	"assignee_id" uuid,
	"note" text DEFAULT '' NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "episode_stages_episode_stage_key" UNIQUE("episode_id","stage")
);
--> statement-breakpoint
CREATE TABLE "subtasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"title" text NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"author_id" uuid,
	"author_name" text DEFAULT '' NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"episode_id" uuid,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" "task_status" DEFAULT 'BACKLOG' NOT NULL,
	"priority" "task_priority" DEFAULT 'NORMAL' NOT NULL,
	"assignee_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"start_date" timestamp with time zone,
	"due_date" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"blocked_by_ids" uuid[] DEFAULT '{}' NOT NULL,
	"created_by_id" uuid,
	"lock_revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"category" "expense_category",
	"period" text,
	"amount" numeric(14, 4) NOT NULL,
	"currency" text DEFAULT 'TWD' NOT NULL,
	"alert_threshold_pct" integer DEFAULT 80 NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budgets_scope_key" UNIQUE("project_id","category","period")
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"episode_id" uuid,
	"category" "expense_category" DEFAULT 'OTHER' NOT NULL,
	"description" text NOT NULL,
	"amount" numeric(14, 4) NOT NULL,
	"currency" text DEFAULT 'TWD' NOT NULL,
	"exchange_rate" numeric(14, 6) DEFAULT '1' NOT NULL,
	"base_currency" text DEFAULT 'TWD' NOT NULL,
	"spent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_by_id" uuid,
	"vendor" text DEFAULT '' NOT NULL,
	"receipt_asset_id" uuid,
	"ai_job_id" uuid,
	"note" text DEFAULT '' NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"episode_id" uuid,
	"kind" "ai_job_kind" NOT NULL,
	"status" "ai_job_status" DEFAULT 'QUEUED' NOT NULL,
	"provider_id" uuid,
	"model" text DEFAULT '' NOT NULL,
	"request" jsonb NOT NULL,
	"result" jsonb,
	"target_type" text DEFAULT '' NOT NULL,
	"target_id" uuid,
	"applied_version_id" uuid,
	"applied_by_id" uuid,
	"applied_at" timestamp with time zone,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"estimated_cost" numeric(12, 6),
	"actual_cost" numeric(12, 6),
	"currency" text DEFAULT 'USD' NOT NULL,
	"error_code" text DEFAULT '' NOT NULL,
	"error_message" text DEFAULT '' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"requested_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "ai_provider_kind" NOT NULL,
	"label" text NOT NULL,
	"default_model" text DEFAULT '' NOT NULL,
	"available_models" text[] DEFAULT '{}' NOT NULL,
	"api_key_ciphertext" text,
	"api_key_last4" text DEFAULT '' NOT NULL,
	"env_var_name" text DEFAULT '' NOT NULL,
	"base_url" text DEFAULT '' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"last_tested_at" timestamp with time zone,
	"last_test_ok" boolean,
	"last_test_message" text DEFAULT '' NOT NULL,
	"monthly_budget" numeric(14, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"user_id" uuid,
	"user_name" text DEFAULT '' NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"summary" text DEFAULT '' NOT NULL,
	"changes" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" "export_kind" NOT NULL,
	"status" "export_status" DEFAULT 'QUEUED' NOT NULL,
	"options" jsonb NOT NULL,
	"asset_id" uuid,
	"error_message" text DEFAULT '' NOT NULL,
	"requested_by_id" uuid,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arcs" ADD CONSTRAINT "arcs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_arc_id_arcs_id_fk" FOREIGN KEY ("arc_id") REFERENCES "public"."arcs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_links" ADD CONSTRAINT "asset_links_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_last_editor_id_users_id_fk" FOREIGN KEY ("last_editor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_version_id_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_resolved_by_id_users_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "versions" ADD CONSTRAINT "versions_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_relationships" ADD CONSTRAINT "character_relationships_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_relationships" ADD CONSTRAINT "character_relationships_from_character_id_characters_id_fk" FOREIGN KEY ("from_character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_relationships" ADD CONSTRAINT "character_relationships_to_character_id_characters_id_fk" FOREIGN KEY ("to_character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_characters" ADD CONSTRAINT "episode_characters_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_characters" ADD CONSTRAINT "episode_characters_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_entries" ADD CONSTRAINT "world_entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shots" ADD CONSTRAINT "shots_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shots" ADD CONSTRAINT "shots_scene_id_scenes_id_fk" FOREIGN KEY ("scene_id") REFERENCES "public"."scenes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shots" ADD CONSTRAINT "shots_speaker_id_characters_id_fk" FOREIGN KEY ("speaker_id") REFERENCES "public"."characters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_stages" ADD CONSTRAINT "episode_stages_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_stages" ADD CONSTRAINT "episode_stages_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subtasks" ADD CONSTRAINT "subtasks_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_paid_by_id_users_id_fk" FOREIGN KEY ("paid_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_jobs" ADD CONSTRAINT "ai_jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_jobs" ADD CONSTRAINT "ai_jobs_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_jobs" ADD CONSTRAINT "ai_jobs_provider_id_ai_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."ai_providers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_jobs" ADD CONSTRAINT "ai_jobs_applied_by_id_users_id_fk" FOREIGN KEY ("applied_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_jobs" ADD CONSTRAINT "ai_jobs_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "arcs_project_idx" ON "arcs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "episodes_arc_number_idx" ON "episodes" USING btree ("arc_id","number");--> statement-breakpoint
CREATE INDEX "episodes_project_idx" ON "episodes" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "episodes_status_idx" ON "episodes" USING btree ("status");--> statement-breakpoint
CREATE INDEX "projects_status_idx" ON "projects" USING btree ("status");--> statement-breakpoint
CREATE INDEX "asset_links_entity_idx" ON "asset_links" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "assets_project_kind_idx" ON "assets" USING btree ("project_id","kind");--> statement-breakpoint
CREATE INDEX "assets_episode_idx" ON "assets" USING btree ("episode_id");--> statement-breakpoint
CREATE INDEX "assets_status_idx" ON "assets" USING btree ("upload_status");--> statement-breakpoint
CREATE INDEX "assets_root_idx" ON "assets" USING btree ("root_asset_id");--> statement-breakpoint
CREATE INDEX "upload_sessions_asset_idx" ON "upload_sessions" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "upload_sessions_status_idx" ON "upload_sessions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "chapters_document_order_idx" ON "chapters" USING btree ("document_id","sort_order");--> statement-breakpoint
CREATE INDEX "documents_episode_idx" ON "documents" USING btree ("episode_id");--> statement-breakpoint
CREATE INDEX "reviews_document_idx" ON "reviews" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "reviews_state_idx" ON "reviews" USING btree ("state");--> statement-breakpoint
CREATE INDEX "scenes_document_order_idx" ON "scenes" USING btree ("document_id","sort_order");--> statement-breakpoint
CREATE INDEX "versions_target_idx" ON "versions" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "char_rel_from_idx" ON "character_relationships" USING btree ("from_character_id");--> statement-breakpoint
CREATE INDEX "char_rel_to_idx" ON "character_relationships" USING btree ("to_character_id");--> statement-breakpoint
CREATE INDEX "char_rel_project_idx" ON "character_relationships" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "characters_project_idx" ON "characters" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "characters_tier_idx" ON "characters" USING btree ("tier");--> statement-breakpoint
CREATE INDEX "episode_characters_character_idx" ON "episode_characters" USING btree ("character_id");--> statement-breakpoint
CREATE INDEX "world_entries_project_category_idx" ON "world_entries" USING btree ("project_id","category");--> statement-breakpoint
CREATE INDEX "shots_episode_order_idx" ON "shots" USING btree ("episode_id","order");--> statement-breakpoint
CREATE INDEX "shots_status_idx" ON "shots" USING btree ("status");--> statement-breakpoint
CREATE INDEX "shots_scene_idx" ON "shots" USING btree ("scene_id");--> statement-breakpoint
CREATE INDEX "episode_stages_episode_idx" ON "episode_stages" USING btree ("episode_id");--> statement-breakpoint
CREATE INDEX "episode_stages_assignee_idx" ON "episode_stages" USING btree ("assignee_id","state");--> statement-breakpoint
CREATE INDEX "subtasks_task_order_idx" ON "subtasks" USING btree ("task_id","sort_order");--> statement-breakpoint
CREATE INDEX "task_comments_task_idx" ON "task_comments" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE INDEX "tasks_project_status_idx" ON "tasks" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "tasks_assignee_idx" ON "tasks" USING btree ("assignee_id");--> statement-breakpoint
CREATE INDEX "tasks_episode_idx" ON "tasks" USING btree ("episode_id");--> statement-breakpoint
CREATE INDEX "tasks_due_idx" ON "tasks" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "expenses_project_category_idx" ON "expenses" USING btree ("project_id","category");--> statement-breakpoint
CREATE INDEX "expenses_spent_at_idx" ON "expenses" USING btree ("spent_at");--> statement-breakpoint
CREATE INDEX "expenses_episode_idx" ON "expenses" USING btree ("episode_id");--> statement-breakpoint
CREATE INDEX "ai_jobs_status_idx" ON "ai_jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "ai_jobs_project_idx" ON "ai_jobs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "ai_jobs_episode_idx" ON "ai_jobs" USING btree ("episode_id");--> statement-breakpoint
CREATE INDEX "ai_jobs_kind_idx" ON "ai_jobs" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "ai_jobs_target_idx" ON "ai_jobs" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "ai_providers_kind_idx" ON "ai_providers" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "activities_created_idx" ON "activities" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "activities_project_idx" ON "activities" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "activities_entity_idx" ON "activities" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "exports_project_idx" ON "exports" USING btree ("project_id","created_at");