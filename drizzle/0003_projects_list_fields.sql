CREATE TABLE "project_favourites" (
	"user_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_favourites_user_id_project_id_pk" PRIMARY KEY("user_id","project_id")
);
--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "status" SET DEFAULT 'PLANNING'::text;--> statement-breakpoint
DROP TYPE "public"."project_status";--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('PLANNING', 'IN_PRODUCTION', 'POST_PRODUCTION', 'COMPLETED', 'RELEASED', 'PAUSED', 'ARCHIVED');--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "status" SET DEFAULT 'PLANNING'::"public"."project_status";--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "status" SET DATA TYPE "public"."project_status" USING "status"::"public"."project_status";--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "tags" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "is_flagship" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "tech_lead_id" uuid;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "start_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "due_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "project_favourites" ADD CONSTRAINT "project_favourites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_favourites" ADD CONSTRAINT "project_favourites_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_favourites_user_idx" ON "project_favourites" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_tech_lead_id_users_id_fk" FOREIGN KEY ("tech_lead_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;