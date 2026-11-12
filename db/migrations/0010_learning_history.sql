-- Additive history; legacy answers/grading remain unchanged by this migration.
CREATE TABLE learning_attempts (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 profile_id text NOT NULL, paper_id text NOT NULL REFERENCES practice_papers(id) ON DELETE CASCADE,
 answers jsonb NOT NULL, grading jsonb NOT NULL DEFAULT '[]',
 source text NOT NULL DEFAULT 'unit', source_id text,
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','grading','completed','failed')),
 grading_source text, error text, started_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
 UNIQUE(id,user_id,profile_id), CHECK(jsonb_typeof(answers)='array'), CHECK(jsonb_typeof(grading)='array')
);
-- Preserve the one genuine pre-history grading; never invent earlier rounds.
INSERT INTO learning_attempts(id,user_id,profile_id,paper_id,answers,grading,source,status,grading_source,started_at,completed_at)
SELECT md5('legacy:'||id)::uuid::text,user_id,profile_id,id,answers,grading,'unit','completed','legacy',created_at,graded_at FROM practice_papers WHERE graded_at IS NOT NULL;
CREATE INDEX learning_attempts_scope ON learning_attempts(user_id,profile_id,paper_id,started_at DESC);
CREATE TABLE learning_drafts (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE, profile_id text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('practice','essay')), source_id text NOT NULL,
 payload jsonb NOT NULL, revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,profile_id,kind,source_id)
);
CREATE TABLE learning_reviews (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE, profile_id text NOT NULL,
 attempt_id text NOT NULL, evidence text NOT NULL CHECK(length(evidence) BETWEEN 1 AND 4000),
 state text NOT NULL CHECK(state IN ('needs_correction','needs_review','reviewed')),
 review_on date, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(attempt_id,user_id,profile_id) REFERENCES learning_attempts(id,user_id,profile_id) ON DELETE CASCADE
);
CREATE INDEX learning_reviews_scope ON learning_reviews(user_id,profile_id,review_on);
CREATE TABLE learning_essay_versions (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE, profile_id text NOT NULL,
 parent_id text, kind text NOT NULL CHECK(kind IN ('original','revision')),
 prompt_text text NOT NULL, original_text text NOT NULL, grade_level text NOT NULL DEFAULT '',
 analysis_error text, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,user_id,profile_id),
 FOREIGN KEY(parent_id,user_id,profile_id) REFERENCES learning_essay_versions(id,user_id,profile_id),
 CHECK((kind='original' AND parent_id IS NULL) OR (kind='revision' AND parent_id IS NOT NULL))
);
CREATE TABLE learning_essay_reports (
 report_id text PRIMARY KEY REFERENCES essay_reports(id) ON DELETE CASCADE,
 version_id text NOT NULL, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE, profile_id text NOT NULL,
 FOREIGN KEY(version_id,user_id,profile_id) REFERENCES learning_essay_versions(id,user_id,profile_id) ON DELETE CASCADE
);
CREATE TRIGGER learning_attempts_active BEFORE INSERT OR UPDATE ON learning_attempts FOR EACH ROW EXECUTE FUNCTION require_active_user();
CREATE TRIGGER learning_drafts_active BEFORE INSERT OR UPDATE ON learning_drafts FOR EACH ROW EXECUTE FUNCTION require_active_user();
CREATE TRIGGER learning_reviews_active BEFORE INSERT OR UPDATE ON learning_reviews FOR EACH ROW EXECUTE FUNCTION require_active_user();
CREATE TRIGGER learning_essay_versions_active BEFORE INSERT OR UPDATE ON learning_essay_versions FOR EACH ROW EXECUTE FUNCTION require_active_user();
CREATE TRIGGER learning_essay_reports_active BEFORE INSERT OR UPDATE ON learning_essay_reports FOR EACH ROW EXECUTE FUNCTION require_active_user();

CREATE TABLE learning_paper_sources (
 paper_id text PRIMARY KEY REFERENCES practice_papers(id) ON DELETE CASCADE,
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE, profile_id text NOT NULL,
 source text NOT NULL CHECK(source IN ('original','similar')), source_id text NOT NULL
);
CREATE TRIGGER learning_paper_sources_active BEFORE INSERT OR UPDATE ON learning_paper_sources FOR EACH ROW EXECUTE FUNCTION require_active_user();

CREATE UNIQUE INDEX learning_essay_reports_version_idx ON learning_essay_reports(version_id);
CREATE UNIQUE INDEX practice_papers_learning_owner_idx ON practice_papers(id,user_id,profile_id);
CREATE UNIQUE INDEX essay_reports_learning_owner_idx ON essay_reports(id,user_id,profile_id);
ALTER TABLE learning_attempts ADD FOREIGN KEY(paper_id,user_id,profile_id) REFERENCES practice_papers(id,user_id,profile_id) ON DELETE CASCADE;
ALTER TABLE learning_paper_sources ADD FOREIGN KEY(paper_id,user_id,profile_id) REFERENCES practice_papers(id,user_id,profile_id) ON DELETE CASCADE;
ALTER TABLE learning_essay_reports ADD FOREIGN KEY(report_id,user_id,profile_id) REFERENCES essay_reports(id,user_id,profile_id) ON DELETE CASCADE;
DO $$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['learning_attempts','learning_drafts','learning_reviews','learning_essay_versions','learning_essay_reports','learning_paper_sources'] LOOP
  EXECUTE format('ALTER TABLE %I ADD FOREIGN KEY(profile_id,user_id) REFERENCES learning_profiles(id,user_id) ON DELETE CASCADE',t);
  EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION preserve_learning_owner()',t||'_preserve_owner',t);
 END LOOP;
END;
$$;

-- A current review per attempt; immutable snapshots record every saved transition.
CREATE UNIQUE INDEX learning_reviews_attempt_idx ON learning_reviews(attempt_id);
CREATE TABLE learning_review_events (
 id text PRIMARY KEY, review_id text NOT NULL REFERENCES learning_reviews(id) ON DELETE CASCADE,
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE, profile_id text NOT NULL,
 evidence text NOT NULL, state text NOT NULL CHECK(state IN ('needs_correction','needs_review','reviewed')),
 review_on date, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(profile_id,user_id) REFERENCES learning_profiles(id,user_id) ON DELETE CASCADE
);
CREATE TRIGGER learning_review_events_active BEFORE INSERT OR UPDATE ON learning_review_events FOR EACH ROW EXECUTE FUNCTION require_active_user();
CREATE TRIGGER learning_review_events_owner BEFORE UPDATE ON learning_review_events FOR EACH ROW EXECUTE FUNCTION preserve_learning_owner();
