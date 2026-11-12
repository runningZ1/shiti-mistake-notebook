ALTER TABLE uploads ADD COLUMN title text NOT NULL DEFAULT '';
ALTER TABLE uploads ADD COLUMN homework_date date;
ALTER TABLE uploads ADD COLUMN grade_level text NOT NULL DEFAULT '';
ALTER TABLE uploads ADD COLUMN original_subject text;
ALTER TABLE uploads ADD COLUMN intent text NOT NULL DEFAULT 'marked' CHECK (intent IN ('marked','check','collect'));
ALTER TABLE uploads ADD COLUMN request_key text;
ALTER TABLE uploads ADD COLUMN photo_hash text;
ALTER TABLE uploads ADD COLUMN page_metadata jsonb NOT NULL DEFAULT '[]';
CREATE UNIQUE INDEX uploads_request_key_idx ON uploads(user_id,request_key) WHERE request_key IS NOT NULL;

CREATE TABLE upload_questions (
 id text PRIMARY KEY, upload_id text NOT NULL, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 profile_id text NOT NULL, page_number integer NOT NULL CHECK(page_number>0), source_index integer,
 original_ocr jsonb, version integer NOT NULL DEFAULT 1 CHECK(version>0),
 question text NOT NULL DEFAULT '', student_answer text NOT NULL DEFAULT '', reference_answer text NOT NULL DEFAULT '',
 reference_source text NOT NULL DEFAULT '照片识别', bounds jsonb NOT NULL DEFAULT '[]',
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','confirmed','ignored')),
 has_figure boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(upload_id,user_id) REFERENCES uploads(id,user_id) ON DELETE CASCADE,
 UNIQUE(upload_id,page_number,source_index), UNIQUE(id,user_id)
);
CREATE INDEX upload_questions_scope_idx ON upload_questions(user_id,profile_id,upload_id);
CREATE TABLE question_versions (
 question_id text NOT NULL REFERENCES upload_questions(id) ON DELETE CASCADE, version integer NOT NULL,
 content jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(question_id,version)
);
CREATE TABLE question_reports (
 id text PRIMARY KEY, question_id text NOT NULL REFERENCES upload_questions(id) ON DELETE CASCADE,
 input_version integer NOT NULL, report jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(question_id,input_version) REFERENCES question_versions(question_id,version) ON DELETE CASCADE
);
ALTER TABLE mistakes ADD COLUMN source_question_id text REFERENCES upload_questions(id) ON DELETE CASCADE;
ALTER TABLE mistakes ADD COLUMN question_version integer;
ALTER TABLE mistakes ADD COLUMN archive_kind text NOT NULL DEFAULT 'mistake' CHECK(archive_kind IN ('mistake','collection'));
ALTER TABLE mistakes ADD COLUMN judgement_source text NOT NULL DEFAULT 'legacy';
CREATE UNIQUE INDEX mistakes_source_question_idx ON mistakes(source_question_id) WHERE source_question_id IS NOT NULL;

CREATE TABLE processing_jobs (
 id text PRIMARY KEY, upload_id text NOT NULL, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 profile_id text NOT NULL, kind text NOT NULL CHECK(kind IN ('recognize','analyze')),
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','completed','failed')),
 input_versions jsonb NOT NULL DEFAULT '{}', attempt integer NOT NULL DEFAULT 0, lease_until timestamptz,
 error text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(upload_id,user_id) REFERENCES uploads(id,user_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX processing_jobs_active_idx ON processing_jobs(upload_id,kind) WHERE status IN ('queued','running');
CREATE INDEX processing_jobs_queue_idx ON processing_jobs(status,created_at);

ALTER TABLE upload_questions ADD CONSTRAINT upload_questions_upload_profile_fk FOREIGN KEY(upload_id,user_id,profile_id) REFERENCES uploads(id,user_id,profile_id) ON DELETE CASCADE;
ALTER TABLE processing_jobs ADD CONSTRAINT processing_jobs_upload_profile_fk FOREIGN KEY(upload_id,user_id,profile_id) REFERENCES uploads(id,user_id,profile_id) ON DELETE CASCADE;
CREATE TRIGGER upload_questions_active BEFORE INSERT OR UPDATE ON upload_questions FOR EACH ROW EXECUTE FUNCTION require_active_user();
CREATE TRIGGER processing_jobs_active BEFORE INSERT OR UPDATE ON processing_jobs FOR EACH ROW EXECUTE FUNCTION require_active_user();
CREATE TRIGGER upload_questions_owner BEFORE UPDATE ON upload_questions FOR EACH ROW EXECUTE FUNCTION preserve_learning_owner();
CREATE TRIGGER processing_jobs_owner BEFORE UPDATE ON processing_jobs FOR EACH ROW EXECUTE FUNCTION preserve_learning_owner();

CREATE TABLE question_edit_drafts (
 upload_id text NOT NULL, user_id text NOT NULL, profile_id text NOT NULL, draft_key text NOT NULL,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), payload jsonb NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(upload_id,draft_key),
 FOREIGN KEY(upload_id,user_id,profile_id) REFERENCES uploads(id,user_id,profile_id) ON DELETE CASCADE,
 CHECK(jsonb_typeof(payload)='object')
);
CREATE TRIGGER question_edit_drafts_active BEFORE INSERT OR UPDATE ON question_edit_drafts FOR EACH ROW EXECUTE FUNCTION require_active_user();
CREATE TRIGGER question_edit_drafts_owner BEFORE UPDATE ON question_edit_drafts FOR EACH ROW EXECUTE FUNCTION preserve_learning_owner();
