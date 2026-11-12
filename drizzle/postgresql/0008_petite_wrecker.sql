-- Schema snapshot companion only. Apply db/migrations/0008 through 0012 with the checksum runner; this generated diff omits backfills and triggers.
CREATE TABLE "learning_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"grade_level" text DEFAULT '' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learning_profiles_name_check" CHECK (char_length(trim("learning_profiles"."name")) BETWEEN 1 AND 40),
	CONSTRAINT "learning_profiles_grade_check" CHECK (char_length("learning_profiles"."grade_level") <= 30)
);
--> statement-breakpoint
CREATE TABLE "processing_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"upload_id" text NOT NULL,
	"user_id" text NOT NULL,
	"profile_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"input_versions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"lease_until" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "question_edit_drafts" (
	"upload_id" text NOT NULL,
	"user_id" text NOT NULL,
	"profile_id" text NOT NULL,
	"draft_key" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"payload" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "question_edit_drafts_upload_id_draft_key_pk" PRIMARY KEY("upload_id","draft_key")
);
--> statement-breakpoint
CREATE TABLE "question_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"question_id" text NOT NULL,
	"input_version" integer NOT NULL,
	"report" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "question_versions" (
	"question_id" text NOT NULL,
	"version" integer NOT NULL,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "question_versions_question_id_version_pk" PRIMARY KEY("question_id","version")
);
--> statement-breakpoint
CREATE TABLE "upload_questions" (
	"id" text PRIMARY KEY NOT NULL,
	"upload_id" text NOT NULL,
	"user_id" text NOT NULL,
	"profile_id" text NOT NULL,
	"page_number" integer NOT NULL,
	"source_index" integer,
	"original_ocr" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"question" text DEFAULT '' NOT NULL,
	"student_answer" text DEFAULT '' NOT NULL,
	"reference_answer" text DEFAULT '' NOT NULL,
	"reference_source" text DEFAULT '照片识别' NOT NULL,
	"bounds" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"has_figure" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"profile_id" text NOT NULL,
	"paper_id" text NOT NULL,
	"answers" jsonb NOT NULL,
	"grading" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source" text DEFAULT 'unit' NOT NULL,
	"source_id" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"grading_source" text,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "learning_attempts_id_user_id_profile_id_unique" UNIQUE("id","user_id","profile_id"),
	CONSTRAINT "learning_attempts_status_check" CHECK ("learning_attempts"."status" IN ('draft','grading','completed','failed')),
	CONSTRAINT "learning_attempts_answers_check" CHECK (jsonb_typeof("learning_attempts"."answers")='array'),
	CONSTRAINT "learning_attempts_grading_check" CHECK (jsonb_typeof("learning_attempts"."grading")='array')
);
--> statement-breakpoint
CREATE TABLE "learning_drafts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"profile_id" text NOT NULL,
	"kind" text NOT NULL,
	"source_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learning_drafts_user_id_profile_id_kind_source_id_unique" UNIQUE("user_id","profile_id","kind","source_id"),
	CONSTRAINT "learning_drafts_kind_check" CHECK ("learning_drafts"."kind" IN ('practice','essay')),
	CONSTRAINT "learning_drafts_revision_check" CHECK ("learning_drafts"."revision">0)
);
--> statement-breakpoint
CREATE TABLE "learning_essay_reports" (
	"report_id" text PRIMARY KEY NOT NULL,
	"version_id" text NOT NULL,
	"user_id" text NOT NULL,
	"profile_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning_essay_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"profile_id" text NOT NULL,
	"parent_id" text,
	"kind" text NOT NULL,
	"prompt_text" text NOT NULL,
	"original_text" text NOT NULL,
	"grade_level" text DEFAULT '' NOT NULL,
	"analysis_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learning_essay_versions_id_user_id_profile_id_unique" UNIQUE("id","user_id","profile_id"),
	CONSTRAINT "learning_essay_versions_kind_check" CHECK ("learning_essay_versions"."kind" IN ('original','revision')),
	CONSTRAINT "learning_essay_versions_check" CHECK (("learning_essay_versions"."kind"='original' AND "learning_essay_versions"."parent_id" IS NULL) OR ("learning_essay_versions"."kind"='revision' AND "learning_essay_versions"."parent_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "learning_paper_sources" (
	"paper_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"profile_id" text NOT NULL,
	"source" text NOT NULL,
	"source_id" text NOT NULL,
	CONSTRAINT "learning_paper_sources_source_check" CHECK ("learning_paper_sources"."source" IN ('original','similar'))
);
--> statement-breakpoint
CREATE TABLE "learning_review_events" (
	"id" text PRIMARY KEY NOT NULL,
	"review_id" text NOT NULL,
	"user_id" text NOT NULL,
	"profile_id" text NOT NULL,
	"evidence" text NOT NULL,
	"state" text NOT NULL,
	"review_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learning_review_events_state_check" CHECK ("learning_review_events"."state" IN ('needs_correction','needs_review','reviewed'))
);
--> statement-breakpoint
CREATE TABLE "learning_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"profile_id" text NOT NULL,
	"attempt_id" text NOT NULL,
	"evidence" text NOT NULL,
	"state" text NOT NULL,
	"review_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learning_reviews_state_check" CHECK ("learning_reviews"."state" IN ('needs_correction','needs_review','reviewed')),
	CONSTRAINT "learning_reviews_evidence_check" CHECK (length("learning_reviews"."evidence") BETWEEN 1 AND 4000)
);
--> statement-breakpoint
CREATE TABLE "workspace_drafts" (
	"user_id" text NOT NULL,
	"profile_id" text NOT NULL,
	"draft_key" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"payload" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_drafts_user_id_profile_id_draft_key_pk" PRIMARY KEY("user_id","profile_id","draft_key"),
	CONSTRAINT "workspace_drafts_key_check" CHECK ("workspace_drafts"."draft_key" ~ '^[a-z][a-z0-9-]{0,63}$'),
	CONSTRAINT "workspace_drafts_version_check" CHECK ("workspace_drafts"."version" > 0),
	CONSTRAINT "workspace_drafts_payload_object" CHECK (jsonb_typeof("workspace_drafts"."payload") = 'object')
);
--> statement-breakpoint
ALTER TABLE "knowledge_units" DROP CONSTRAINT "knowledge_units_user_id_subject_knowledge_point_pk";--> statement-breakpoint
ALTER TABLE "knowledge_units" ADD CONSTRAINT "knowledge_units_user_id_profile_id_subject_knowledge_point_pk" PRIMARY KEY("user_id","profile_id","subject","knowledge_point");--> statement-breakpoint
ALTER TABLE "essay_reports" ADD COLUMN "profile_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_units" ADD COLUMN "profile_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "mistakes" ADD COLUMN "profile_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "mistakes" ADD COLUMN "removed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mistakes" ADD COLUMN "source_question_id" text;--> statement-breakpoint
ALTER TABLE "mistakes" ADD COLUMN "question_version" integer;--> statement-breakpoint
ALTER TABLE "mistakes" ADD COLUMN "archive_kind" text DEFAULT 'mistake' NOT NULL;--> statement-breakpoint
ALTER TABLE "mistakes" ADD COLUMN "judgement_source" text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "practice_papers" ADD COLUMN "profile_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "upload_objects" ADD COLUMN "profile_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "uploads" ADD COLUMN "profile_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "uploads" ADD COLUMN "title" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "uploads" ADD COLUMN "homework_date" date;--> statement-breakpoint
ALTER TABLE "uploads" ADD COLUMN "grade_level" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "uploads" ADD COLUMN "original_subject" text;--> statement-breakpoint
ALTER TABLE "uploads" ADD COLUMN "intent" text DEFAULT 'marked' NOT NULL;--> statement-breakpoint
ALTER TABLE "uploads" ADD COLUMN "request_key" text;--> statement-breakpoint
ALTER TABLE "uploads" ADD COLUMN "photo_hash" text;--> statement-breakpoint
ALTER TABLE "uploads" ADD COLUMN "page_metadata" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "learning_profiles" ADD CONSTRAINT "learning_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_upload_id_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."uploads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_profile_id_learning_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."learning_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_edit_drafts" ADD CONSTRAINT "question_edit_drafts_upload_id_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."uploads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_edit_drafts" ADD CONSTRAINT "question_edit_drafts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_edit_drafts" ADD CONSTRAINT "question_edit_drafts_profile_id_learning_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."learning_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_reports" ADD CONSTRAINT "question_reports_question_id_upload_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."upload_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_versions" ADD CONSTRAINT "question_versions_question_id_upload_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."upload_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_questions" ADD CONSTRAINT "upload_questions_upload_id_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."uploads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_questions" ADD CONSTRAINT "upload_questions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_questions" ADD CONSTRAINT "upload_questions_profile_id_learning_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."learning_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_attempts" ADD CONSTRAINT "learning_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_attempts" ADD CONSTRAINT "learning_attempts_paper_id_practice_papers_id_fk" FOREIGN KEY ("paper_id") REFERENCES "public"."practice_papers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_attempts" ADD CONSTRAINT "learning_attempts_profile_id_user_id_learning_profiles_id_user_id_fk" FOREIGN KEY ("profile_id","user_id") REFERENCES "public"."learning_profiles"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_attempts" ADD CONSTRAINT "learning_attempts_paper_id_user_id_profile_id_practice_papers_id_user_id_profile_id_fk" FOREIGN KEY ("paper_id","user_id","profile_id") REFERENCES "public"."practice_papers"("id","user_id","profile_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_drafts" ADD CONSTRAINT "learning_drafts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_drafts" ADD CONSTRAINT "learning_drafts_profile_id_user_id_learning_profiles_id_user_id_fk" FOREIGN KEY ("profile_id","user_id") REFERENCES "public"."learning_profiles"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_essay_reports" ADD CONSTRAINT "learning_essay_reports_report_id_essay_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."essay_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_essay_reports" ADD CONSTRAINT "learning_essay_reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_essay_reports" ADD CONSTRAINT "learning_essay_reports_version_id_user_id_profile_id_learning_essay_versions_id_user_id_profile_id_fk" FOREIGN KEY ("version_id","user_id","profile_id") REFERENCES "public"."learning_essay_versions"("id","user_id","profile_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_essay_reports" ADD CONSTRAINT "learning_essay_reports_report_id_user_id_profile_id_essay_reports_id_user_id_profile_id_fk" FOREIGN KEY ("report_id","user_id","profile_id") REFERENCES "public"."essay_reports"("id","user_id","profile_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_essay_reports" ADD CONSTRAINT "learning_essay_reports_profile_id_user_id_learning_profiles_id_user_id_fk" FOREIGN KEY ("profile_id","user_id") REFERENCES "public"."learning_profiles"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_essay_versions" ADD CONSTRAINT "learning_essay_versions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_essay_versions" ADD CONSTRAINT "learning_essay_versions_parent_id_user_id_profile_id_learning_essay_versions_id_user_id_profile_id_fk" FOREIGN KEY ("parent_id","user_id","profile_id") REFERENCES "public"."learning_essay_versions"("id","user_id","profile_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_essay_versions" ADD CONSTRAINT "learning_essay_versions_profile_id_user_id_learning_profiles_id_user_id_fk" FOREIGN KEY ("profile_id","user_id") REFERENCES "public"."learning_profiles"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_paper_sources" ADD CONSTRAINT "learning_paper_sources_paper_id_practice_papers_id_fk" FOREIGN KEY ("paper_id") REFERENCES "public"."practice_papers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_paper_sources" ADD CONSTRAINT "learning_paper_sources_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_paper_sources" ADD CONSTRAINT "learning_paper_sources_paper_id_user_id_profile_id_practice_papers_id_user_id_profile_id_fk" FOREIGN KEY ("paper_id","user_id","profile_id") REFERENCES "public"."practice_papers"("id","user_id","profile_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_paper_sources" ADD CONSTRAINT "learning_paper_sources_profile_id_user_id_learning_profiles_id_user_id_fk" FOREIGN KEY ("profile_id","user_id") REFERENCES "public"."learning_profiles"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_review_events" ADD CONSTRAINT "learning_review_events_review_id_learning_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."learning_reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_review_events" ADD CONSTRAINT "learning_review_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_review_events" ADD CONSTRAINT "learning_review_events_profile_id_user_id_learning_profiles_id_user_id_fk" FOREIGN KEY ("profile_id","user_id") REFERENCES "public"."learning_profiles"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_reviews" ADD CONSTRAINT "learning_reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_reviews" ADD CONSTRAINT "learning_reviews_attempt_id_user_id_profile_id_learning_attempts_id_user_id_profile_id_fk" FOREIGN KEY ("attempt_id","user_id","profile_id") REFERENCES "public"."learning_attempts"("id","user_id","profile_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_reviews" ADD CONSTRAINT "learning_reviews_profile_id_user_id_learning_profiles_id_user_id_fk" FOREIGN KEY ("profile_id","user_id") REFERENCES "public"."learning_profiles"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_drafts" ADD CONSTRAINT "workspace_drafts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_drafts" ADD CONSTRAINT "workspace_drafts_profile_user_fk" FOREIGN KEY ("profile_id","user_id") REFERENCES "public"."learning_profiles"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "learning_profiles_id_user_idx" ON "learning_profiles" USING btree ("id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "learning_profiles_default_idx" ON "learning_profiles" USING btree ("user_id") WHERE "learning_profiles"."is_default";--> statement-breakpoint
CREATE UNIQUE INDEX "upload_questions_source_idx" ON "upload_questions" USING btree ("upload_id","page_number","source_index");--> statement-breakpoint
CREATE INDEX "upload_questions_scope_idx" ON "upload_questions" USING btree ("user_id","profile_id","upload_id");--> statement-breakpoint
CREATE INDEX "learning_attempts_scope" ON "learning_attempts" USING btree ("user_id","profile_id","paper_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "learning_essay_reports_version_idx" ON "learning_essay_reports" USING btree ("version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "learning_reviews_attempt_idx" ON "learning_reviews" USING btree ("attempt_id");--> statement-breakpoint
CREATE INDEX "learning_reviews_scope" ON "learning_reviews" USING btree ("user_id","profile_id","review_on");--> statement-breakpoint
ALTER TABLE "essay_reports" ADD CONSTRAINT "essay_reports_profile_id_learning_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."learning_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_units" ADD CONSTRAINT "knowledge_units_profile_id_learning_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."learning_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mistakes" ADD CONSTRAINT "mistakes_profile_id_learning_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."learning_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_papers" ADD CONSTRAINT "practice_papers_profile_id_learning_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."learning_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_objects" ADD CONSTRAINT "upload_objects_profile_id_learning_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."learning_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_profile_id_learning_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."learning_profiles"("id") ON DELETE no action ON UPDATE no action;