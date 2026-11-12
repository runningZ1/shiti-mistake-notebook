-- Run via the checksum migration runner inside its transaction; never auto-run at startup.
CREATE TABLE learning_profiles (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  grade_level text NOT NULL DEFAULT '',
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT learning_profiles_name_check CHECK (char_length(trim(name)) BETWEEN 1 AND 40),
  CONSTRAINT learning_profiles_grade_check CHECK (char_length(grade_level) <= 30)
);
CREATE UNIQUE INDEX learning_profiles_id_user_idx ON learning_profiles(id, user_id);
CREATE UNIQUE INDEX learning_profiles_default_idx ON learning_profiles(user_id) WHERE is_default;
INSERT INTO learning_profiles(id,user_id,name,is_default,created_at)
  SELECT 'default:' || id,id,'默认档案',true,created_at FROM users;

-- Existing disabled accounts also retain all historical data. Only suspend the
-- account-state triggers for this transactional backfill, then restore them.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['uploads','upload_objects','mistakes','practice_papers','knowledge_units','essay_reports'] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN profile_id text', t);
    EXECUTE format('ALTER TABLE %I DISABLE TRIGGER %I', t, t || '_require_active_user');
    EXECUTE format('UPDATE %I SET profile_id = ''default:'' || user_id', t);
    EXECUTE format('ALTER TABLE %I ENABLE TRIGGER %I', t, t || '_require_active_user');
    EXECUTE format('ALTER TABLE %I ALTER COLUMN profile_id SET NOT NULL', t);
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (profile_id,user_id) REFERENCES learning_profiles(id,user_id) ON DELETE CASCADE', t, t || '_profile_user_fk');
    EXECUTE format('CREATE INDEX %I ON %I(user_id,profile_id)', t || '_user_profile_idx', t);
  END LOOP;
END;
$$;
ALTER TABLE mistakes ADD COLUMN removed_at timestamptz;
CREATE INDEX mistakes_profile_active_created_idx ON mistakes(user_id,profile_id,created_at,id) WHERE removed_at IS NULL;
CREATE UNIQUE INDEX uploads_id_user_profile_idx ON uploads(id,user_id,profile_id);
ALTER TABLE mistakes ADD CONSTRAINT mistakes_upload_profile_fk FOREIGN KEY(upload_id,user_id,profile_id)
  REFERENCES uploads(id,user_id,profile_id) ON DELETE CASCADE;
ALTER TABLE knowledge_units DROP CONSTRAINT knowledge_units_pkey;
ALTER TABLE knowledge_units ADD PRIMARY KEY(user_id,profile_id,subject,knowledge_point);

-- Profiles and existing materials cannot silently change owner after creation.
CREATE FUNCTION preserve_learning_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.profile_id IS DISTINCT FROM OLD.profile_id THEN
    RAISE EXCEPTION '学习资料归属不可更改' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['uploads','upload_objects','mistakes','practice_papers','knowledge_units','essay_reports'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION preserve_learning_owner()', t || '_preserve_owner', t);
  END LOOP;
END;
$$;

-- Object keys keep their original format. A tracked object belonging to an
-- upload must share its profile, in either insertion order.
CREATE FUNCTION check_upload_object_profile() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id, 8008));
  IF TG_TABLE_NAME = 'uploads' THEN
    IF EXISTS (SELECT 1 FROM upload_objects o WHERE o.user_id = NEW.user_id
      AND starts_with(o.key, NEW.user_id || '/' || NEW.id || '/')
      AND o.profile_id <> NEW.profile_id) THEN
      RAISE EXCEPTION '图片与上传档案不一致' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM uploads u WHERE u.user_id = NEW.user_id
      AND starts_with(NEW.key, u.user_id || '/' || u.id || '/')
      AND u.profile_id <> NEW.profile_id) THEN
      RAISE EXCEPTION '图片与上传档案不一致' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER uploads_check_object_profile BEFORE INSERT OR UPDATE ON uploads FOR EACH ROW EXECUTE FUNCTION check_upload_object_profile();
CREATE TRIGGER upload_objects_check_profile BEFORE INSERT OR UPDATE ON upload_objects FOR EACH ROW EXECUTE FUNCTION check_upload_object_profile();
CREATE TRIGGER learning_profiles_require_active_user BEFORE INSERT OR UPDATE ON learning_profiles FOR EACH ROW EXECUTE FUNCTION require_active_user();
