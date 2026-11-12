CREATE TABLE workspace_drafts (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  profile_id text NOT NULL,
  draft_key text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, profile_id, draft_key),
  CONSTRAINT workspace_drafts_profile_user_fk FOREIGN KEY (profile_id, user_id)
    REFERENCES learning_profiles(id, user_id) ON DELETE CASCADE,
  CONSTRAINT workspace_drafts_key_check CHECK (draft_key ~ '^[a-z][a-z0-9-]{0,63}$'),
  CONSTRAINT workspace_drafts_version_check CHECK (version > 0),
  CONSTRAINT workspace_drafts_payload_object CHECK (jsonb_typeof(payload) = 'object')
);
CREATE TRIGGER workspace_drafts_require_active_user BEFORE INSERT OR UPDATE ON workspace_drafts
  FOR EACH ROW EXECUTE FUNCTION require_active_user();
CREATE TRIGGER workspace_drafts_preserve_owner BEFORE UPDATE ON workspace_drafts
  FOR EACH ROW EXECUTE FUNCTION preserve_learning_owner();
