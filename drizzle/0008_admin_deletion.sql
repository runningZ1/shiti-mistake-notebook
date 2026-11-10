ALTER TABLE `users` ADD `deletion_started_at` text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `upload_objects` (
  `key` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `multipart_id` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `upload_objects_user_idx` ON `upload_objects` (`user_id`);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `upload_objects_require_active_user`
BEFORE INSERT ON `upload_objects`
WHEN NOT EXISTS (SELECT 1 FROM `users` WHERE `id` = NEW.user_id AND `status` = 'active' AND `deletion_started_at` IS NULL)
BEGIN
  SELECT RAISE(ABORT, '账号不可用，无法保存图片');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `uploads_require_active_user`
BEFORE INSERT ON `uploads`
WHEN NOT EXISTS (SELECT 1 FROM `users` WHERE `id` = NEW.user_id AND `status` = 'active' AND `deletion_started_at` IS NULL)
BEGIN
  SELECT RAISE(ABORT, '账号不可用，无法保存数据');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `mistakes_require_active_user`
BEFORE INSERT ON `mistakes`
WHEN NOT EXISTS (SELECT 1 FROM `users` WHERE `id` = NEW.user_id AND `status` = 'active' AND `deletion_started_at` IS NULL)
BEGIN
  SELECT RAISE(ABORT, '账号不可用，无法保存数据');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `practice_papers_require_active_user`
BEFORE INSERT ON `practice_papers`
WHEN NOT EXISTS (SELECT 1 FROM `users` WHERE `id` = NEW.user_id AND `status` = 'active' AND `deletion_started_at` IS NULL)
BEGIN
  SELECT RAISE(ABORT, '账号不可用，无法保存数据');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `essay_reports_require_active_user`
BEFORE INSERT ON `essay_reports`
WHEN NOT EXISTS (SELECT 1 FROM `users` WHERE `id` = NEW.user_id AND `status` = 'active' AND `deletion_started_at` IS NULL)
BEGIN
  SELECT RAISE(ABORT, '账号不可用，无法保存数据');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `knowledge_units_require_active_user`
BEFORE INSERT ON `knowledge_units`
WHEN NOT EXISTS (SELECT 1 FROM `users` WHERE `id` = NEW.user_id AND `status` = 'active' AND `deletion_started_at` IS NULL)
BEGIN
  SELECT RAISE(ABORT, '账号不可用，无法保存数据');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `uploads_update_require_active_user`
BEFORE UPDATE ON `uploads`
WHEN NOT EXISTS (SELECT 1 FROM `users` WHERE `id` = NEW.user_id AND `status` = 'active' AND `deletion_started_at` IS NULL)
BEGIN
  SELECT RAISE(ABORT, '账号不可用，无法保存数据');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `mistakes_update_require_active_user`
BEFORE UPDATE ON `mistakes`
WHEN NOT EXISTS (SELECT 1 FROM `users` WHERE `id` = NEW.user_id AND `status` = 'active' AND `deletion_started_at` IS NULL)
BEGIN
  SELECT RAISE(ABORT, '账号不可用，无法保存数据');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `practice_papers_update_require_active_user`
BEFORE UPDATE ON `practice_papers`
WHEN NOT EXISTS (SELECT 1 FROM `users` WHERE `id` = NEW.user_id AND `status` = 'active' AND `deletion_started_at` IS NULL)
BEGIN
  SELECT RAISE(ABORT, '账号不可用，无法保存数据');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `essay_reports_update_require_active_user`
BEFORE UPDATE ON `essay_reports`
WHEN NOT EXISTS (SELECT 1 FROM `users` WHERE `id` = NEW.user_id AND `status` = 'active' AND `deletion_started_at` IS NULL)
BEGIN
  SELECT RAISE(ABORT, '账号不可用，无法保存数据');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `knowledge_units_update_require_active_user`
BEFORE UPDATE ON `knowledge_units`
WHEN NOT EXISTS (SELECT 1 FROM `users` WHERE `id` = NEW.user_id AND `status` = 'active' AND `deletion_started_at` IS NULL)
BEGIN
  SELECT RAISE(ABORT, '账号不可用，无法保存数据');
END;
