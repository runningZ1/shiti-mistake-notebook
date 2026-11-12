ALTER TABLE "uploads" ADD COLUMN "analysis_result" jsonb;--> statement-breakpoint
ALTER TABLE "uploads" ADD COLUMN "analysis_status" text DEFAULT 'completed' NOT NULL;--> statement-breakpoint
ALTER TABLE "uploads" ADD COLUMN "analysis_error" text;--> statement-breakpoint
ALTER TABLE "uploads" ADD COLUMN "analysis_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "uploads" ADD COLUMN "analysis_attempt_id" text;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_analysis_result_object" CHECK ("uploads"."analysis_result" IS NULL OR jsonb_typeof("uploads"."analysis_result") = 'object');--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_analysis_status_check" CHECK ("uploads"."analysis_status" IN ('processing','completed','failed'));