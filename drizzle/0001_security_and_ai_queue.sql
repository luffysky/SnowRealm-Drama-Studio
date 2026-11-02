CREATE TYPE "public"."security_event_kind" AS ENUM('LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGIN_RATE_LIMITED', 'LOGOUT', 'PASSWORD_CHANGED', 'PASSWORD_REHASHED', 'SESSION_REVOKED');--> statement-breakpoint
CREATE TABLE "ai_job_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"status" "ai_job_status" NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 6),
	"error_code" text DEFAULT '' NOT NULL,
	"error_message" text DEFAULT '' NOT NULL,
	"retryable" boolean DEFAULT false NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "model_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task" "ai_job_kind" NOT NULL,
	"provider_id" uuid NOT NULL,
	"model" text NOT NULL,
	"effort" text DEFAULT 'high' NOT NULL,
	"max_tokens" integer DEFAULT 32000 NOT NULL,
	"candidates" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "security_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "security_event_kind" NOT NULL,
	"user_id" uuid,
	"email" text DEFAULT '' NOT NULL,
	"ip_address" text DEFAULT '' NOT NULL,
	"user_agent" text DEFAULT '' NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "arcs" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "episodes" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "world_entries" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ai_jobs" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "ai_jobs" ADD COLUMN "priority" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_jobs" ADD COLUMN "locked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ai_jobs" ADD COLUMN "locked_by" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_jobs" ADD COLUMN "max_attempts" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_jobs" ADD COLUMN "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_jobs" ADD COLUMN "cancel_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ai_jobs" ADD COLUMN "progress" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_jobs" ADD COLUMN "progress_note" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_providers" ADD COLUMN "max_concurrency" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_providers" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ai_job_attempts" ADD CONSTRAINT "ai_job_attempts_job_id_ai_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."ai_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_assignments" ADD CONSTRAINT "model_assignments_provider_id_ai_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."ai_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_events" ADD CONSTRAINT "security_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_job_attempts_job_idx" ON "ai_job_attempts" USING btree ("job_id","attempt");--> statement-breakpoint
CREATE UNIQUE INDEX "model_assignments_task_idx" ON "model_assignments" USING btree ("task");--> statement-breakpoint
CREATE INDEX "security_events_email_time_idx" ON "security_events" USING btree ("email","kind","created_at");--> statement-breakpoint
CREATE INDEX "security_events_ip_time_idx" ON "security_events" USING btree ("ip_address","kind","created_at");--> statement-breakpoint
CREATE INDEX "security_events_user_idx" ON "security_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_jobs_claim_idx" ON "ai_jobs" USING btree ("status","next_attempt_at","priority");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_jobs_idempotency_key_idx" ON "ai_jobs" USING btree ("idempotency_key") WHERE "ai_jobs"."idempotency_key" is not null;