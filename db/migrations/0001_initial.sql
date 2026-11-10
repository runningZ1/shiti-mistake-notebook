CREATE TABLE users (
  id text PRIMARY KEY,
  username text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  role text NOT NULL DEFAULT 'user',
  status text NOT NULL DEFAULT 'active',
  session_epoch integer NOT NULL DEFAULT 0,
  last_login_at timestamptz,
  wechat text,
  trial_ends_at timestamptz,
  deletion_started_at timestamptz,
  CONSTRAINT users_role_check CHECK (role IN ('user', 'admin')),
  CONSTRAINT users_status_check CHECK (status IN ('active', 'disabled')),
  CONSTRAINT users_session_epoch_check CHECK (session_epoch >= 0),
  CONSTRAINT users_deletion_status_check CHECK (deletion_started_at IS NULL OR status = 'disabled')
);
CREATE INDEX users_created_idx ON users (created_at, id);

CREATE TABLE uploads (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject text NOT NULL,
  file_keys jsonb NOT NULL,
  file_names jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uploads_file_keys_array CHECK (jsonb_typeof(file_keys) = 'array'),
  CONSTRAINT uploads_file_names_array CHECK (jsonb_typeof(file_names) = 'array')
);
CREATE UNIQUE INDEX uploads_id_user_idx ON uploads (id, user_id);
CREATE INDEX uploads_user_created_idx ON uploads (user_id, created_at, id);

CREATE TABLE upload_objects (
  key text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  multipart_id text NOT NULL
);
CREATE INDEX upload_objects_user_idx ON upload_objects (user_id);

CREATE TABLE mistakes (
  id text PRIMARY KEY,
  upload_id text NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject text NOT NULL,
  question text NOT NULL,
  incorrect_answer text NOT NULL,
  correct_answer text NOT NULL,
  reasoning text NOT NULL,
  knowledge_point text NOT NULL,
  page_number integer NOT NULL,
  source_name text NOT NULL,
  similar_questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mistakes_upload_user_fk FOREIGN KEY (upload_id, user_id) REFERENCES uploads(id, user_id) ON DELETE CASCADE,
  CONSTRAINT mistakes_page_number_check CHECK (page_number > 0),
  CONSTRAINT mistakes_similar_array CHECK (jsonb_typeof(similar_questions) = 'array')
);
CREATE INDEX mistakes_user_created_idx ON mistakes (user_id, created_at, id);
CREATE INDEX mistakes_upload_idx ON mistakes (upload_id);
CREATE INDEX mistakes_subject_created_idx ON mistakes (subject, created_at, id);

CREATE TABLE practice_papers (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject text NOT NULL,
  unit_name text NOT NULL,
  grade_level text NOT NULL DEFAULT '',
  questions jsonb NOT NULL,
  answers jsonb NOT NULL DEFAULT '[]'::jsonb,
  grading jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  graded_at timestamptz
);
CREATE INDEX practice_papers_user_created_idx ON practice_papers (user_id, created_at, id);

CREATE TABLE knowledge_units (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject text NOT NULL,
  knowledge_point text NOT NULL,
  unit_name text NOT NULL DEFAULT '',
  guide jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, subject, knowledge_point)
);

CREATE TABLE essay_reports (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prompt_text text NOT NULL DEFAULT '',
  original_text text NOT NULL,
  grade_level text NOT NULL DEFAULT '',
  report_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX essay_reports_user_created_idx ON essay_reports (user_id, created_at, id);

CREATE FUNCTION require_active_user() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  account_status text;
  account_deletion timestamptz;
BEGIN
  SELECT status, deletion_started_at INTO account_status, account_deletion
    FROM users WHERE id = NEW.user_id FOR SHARE;
  IF NOT FOUND OR account_status <> 'active' OR account_deletion IS NOT NULL THEN
    RAISE EXCEPTION '账号不可用，无法保存数据' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER uploads_require_active_user BEFORE INSERT OR UPDATE ON uploads
  FOR EACH ROW EXECUTE FUNCTION require_active_user();
CREATE TRIGGER upload_objects_require_active_user BEFORE INSERT OR UPDATE ON upload_objects
  FOR EACH ROW EXECUTE FUNCTION require_active_user();
CREATE TRIGGER mistakes_require_active_user BEFORE INSERT OR UPDATE ON mistakes
  FOR EACH ROW EXECUTE FUNCTION require_active_user();
CREATE TRIGGER practice_papers_require_active_user BEFORE INSERT OR UPDATE ON practice_papers
  FOR EACH ROW EXECUTE FUNCTION require_active_user();
CREATE TRIGGER knowledge_units_require_active_user BEFORE INSERT OR UPDATE ON knowledge_units
  FOR EACH ROW EXECUTE FUNCTION require_active_user();
CREATE TRIGGER essay_reports_require_active_user BEFORE INSERT OR UPDATE ON essay_reports
  FOR EACH ROW EXECUTE FUNCTION require_active_user();
