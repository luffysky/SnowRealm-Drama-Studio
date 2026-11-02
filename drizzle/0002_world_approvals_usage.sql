CREATE TYPE "public"."approval_state" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'UNLOCKED');--> statement-breakpoint
CREATE TYPE "public"."asset_variant_kind" AS ENUM('THUMBNAIL', 'PREVIEW', 'CROP', 'BG_REMOVED', 'UPSCALED', 'WATERMARKED', 'TRANSCODE', 'WAVEFORM', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."notification_kind" AS ENUM('AI_JOB_DONE', 'AI_JOB_FAILED', 'REVIEW_REQUESTED', 'APPROVAL_GRANTED', 'TASK_ASSIGNED', 'TASK_DUE', 'BUDGET_WARNING', 'MENTION', 'SYSTEM');--> statement-breakpoint
CREATE TYPE "public"."usage_kind" AS ENUM('ESTIMATE', 'ACTUAL');--> statement-breakpoint
CREATE TYPE "public"."usage_source" AS ENUM('AI_JOB', 'STORAGE', 'MANUAL');--> statement-breakpoint
CREATE TYPE "public"."world_event_scope" AS ENUM('BACKSTORY', 'MAIN_TIMELINE', 'PREVIOUS_LIFE', 'FORESHADOWED');--> statement-breakpoint
CREATE TABLE "asset_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"kind" "asset_variant_kind" NOT NULL,
	"object_key" text NOT NULL,
	"mime_type" text DEFAULT '' NOT NULL,
	"size_bytes" bigint DEFAULT 0 NOT NULL,
	"width" integer,
	"height" integer,
	"duration_sec" integer,
	"params" jsonb,
	"upload_status" "upload_status" DEFAULT 'PENDING' NOT NULL,
	"checksum" text DEFAULT '' NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_variants_object_key_unique" UNIQUE("object_key"),
	CONSTRAINT "asset_variants_asset_kind_key" UNIQUE("asset_id","kind")
);
--> statement-breakpoint
CREATE TABLE "approval_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"target_type" "version_target" NOT NULL,
	"target_id" uuid NOT NULL,
	"version_id" uuid,
	"state" "approval_state" DEFAULT 'PENDING' NOT NULL,
	"locks" boolean DEFAULT false NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"requested_by_id" uuid,
	"decided_by_id" uuid,
	"decided_at" timestamp with time zone,
	"unlock_reason" text DEFAULT '' NOT NULL,
	"supersedes_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "version_branches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_type" "version_target" NOT NULL,
	"target_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"base_version_id" uuid,
	"head_version_id" uuid,
	"is_trunk" boolean DEFAULT false NOT NULL,
	"merged_into_version_id" uuid,
	"merged_at" timestamp with time zone,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "version_branches_target_name_key" UNIQUE("target_type","target_id","name")
);
--> statement-breakpoint
CREATE TABLE "world_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"scope" "world_event_scope" DEFAULT 'MAIN_TIMELINE' NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"era_label" text DEFAULT '' NOT NULL,
	"in_universe_order" integer DEFAULT 0 NOT NULL,
	"revealed_in_episode" integer,
	"related_entry_ids" uuid[] DEFAULT '{}' NOT NULL,
	"character_ids" uuid[] DEFAULT '{}' NOT NULL,
	"is_canon" boolean DEFAULT true NOT NULL,
	"payoff_event_id" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"episode_id" uuid,
	"source" "usage_source" NOT NULL,
	"kind" "usage_kind" NOT NULL,
	"ref_id" uuid,
	"description" text DEFAULT '' NOT NULL,
	"unit" text DEFAULT '' NOT NULL,
	"quantity" numeric(18, 4) DEFAULT '0' NOT NULL,
	"amount" numeric(14, 6) DEFAULT '0' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"period" text NOT NULL,
	"settles_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_outputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"attempt_id" uuid,
	"index" integer NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"structured" jsonb,
	"char_count" integer DEFAULT 0 NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"chosen_at" timestamp with time zone,
	"chosen_by_id" uuid,
	"applied_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "notification_kind" NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"href" text DEFAULT '' NOT NULL,
	"project_id" uuid,
	"entity_type" text DEFAULT '' NOT NULL,
	"entity_id" uuid,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "versions" ADD COLUMN "branch_id" uuid;--> statement-breakpoint
ALTER TABLE "versions" ADD COLUMN "parent_version_id" uuid;--> statement-breakpoint
ALTER TABLE "asset_variants" ADD CONSTRAINT "asset_variants_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_variants" ADD CONSTRAINT "asset_variants_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_records" ADD CONSTRAINT "approval_records_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_records" ADD CONSTRAINT "approval_records_version_id_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_records" ADD CONSTRAINT "approval_records_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_records" ADD CONSTRAINT "approval_records_decided_by_id_users_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "version_branches" ADD CONSTRAINT "version_branches_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_events" ADD CONSTRAINT "world_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD CONSTRAINT "usage_ledger_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD CONSTRAINT "usage_ledger_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_outputs" ADD CONSTRAINT "ai_outputs_job_id_ai_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."ai_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_outputs" ADD CONSTRAINT "ai_outputs_attempt_id_ai_job_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."ai_job_attempts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_outputs" ADD CONSTRAINT "ai_outputs_chosen_by_id_users_id_fk" FOREIGN KEY ("chosen_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_variants_asset_idx" ON "asset_variants" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "approval_records_target_idx" ON "approval_records" USING btree ("target_type","target_id","created_at");--> statement-breakpoint
CREATE INDEX "approval_records_state_idx" ON "approval_records" USING btree ("state");--> statement-breakpoint
CREATE INDEX "approval_records_project_idx" ON "approval_records" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "version_branches_target_idx" ON "version_branches" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "world_events_project_order_idx" ON "world_events" USING btree ("project_id","in_universe_order");--> statement-breakpoint
CREATE INDEX "world_events_reveal_idx" ON "world_events" USING btree ("project_id","revealed_in_episode");--> statement-breakpoint
CREATE INDEX "world_events_scope_idx" ON "world_events" USING btree ("scope");--> statement-breakpoint
CREATE INDEX "usage_ledger_project_period_idx" ON "usage_ledger" USING btree ("project_id","period","kind");--> statement-breakpoint
CREATE INDEX "usage_ledger_ref_idx" ON "usage_ledger" USING btree ("source","ref_id");--> statement-breakpoint
CREATE INDEX "usage_ledger_occurred_idx" ON "usage_ledger" USING btree ("occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_outputs_job_index_key" ON "ai_outputs" USING btree ("job_id","index");--> statement-breakpoint
CREATE INDEX "ai_outputs_job_idx" ON "ai_outputs" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "notifications_user_unread_idx" ON "notifications" USING btree ("user_id","read_at","created_at");--> statement-breakpoint
CREATE INDEX "notifications_entity_idx" ON "notifications" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "versions_branch_idx" ON "versions" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "versions_parent_idx" ON "versions" USING btree ("parent_version_id");