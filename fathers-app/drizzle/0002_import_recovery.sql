DROP INDEX `idx_candidates_dad_media`;--> statement-breakpoint
ALTER TABLE `photo_candidates` ADD `picker_session_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_candidates_user_dad_media` ON `photo_candidates` (`user_id`,`dad`,`google_media_id`);--> statement-breakpoint
CREATE INDEX `idx_candidates_picker_session` ON `photo_candidates` (`picker_session_id`);--> statement-breakpoint
CREATE INDEX `idx_candidates_r2_key` ON `photo_candidates` (`r2_key`);--> statement-breakpoint
ALTER TABLE `picker_sessions` ADD `lock_token` text;--> statement-breakpoint
ALTER TABLE `picker_sessions` ADD `lock_until` integer DEFAULT 0 NOT NULL;