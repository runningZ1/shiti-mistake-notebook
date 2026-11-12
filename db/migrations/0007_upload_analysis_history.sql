ALTER TABLE uploads ADD COLUMN analysis_result jsonb;
ALTER TABLE uploads ADD COLUMN analysis_status text NOT NULL DEFAULT 'completed';
ALTER TABLE uploads ADD COLUMN analysis_error text;
ALTER TABLE uploads ADD COLUMN analysis_started_at timestamptz;
ALTER TABLE uploads ADD COLUMN analysis_attempt_id text;
ALTER TABLE uploads ADD CONSTRAINT uploads_analysis_result_object
  CHECK (analysis_result IS NULL OR jsonb_typeof(analysis_result) = 'object');
ALTER TABLE uploads ADD CONSTRAINT uploads_analysis_status_check
  CHECK (analysis_status IN ('processing','completed','failed'));
