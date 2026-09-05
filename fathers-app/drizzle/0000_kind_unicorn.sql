CREATE TABLE `google_connections` (
	`user_id` text PRIMARY KEY NOT NULL,
	`user_email` text NOT NULL,
	`encrypted_refresh_token` text NOT NULL,
	`token_iv` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `oauth_states` (
	`state` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`user_email` text NOT NULL,
	`dad` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `photo_candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`dad` text NOT NULL,
	`google_media_id` text NOT NULL,
	`r2_key` text NOT NULL,
	`filename` text NOT NULL,
	`mime_type` text NOT NULL,
	`caption` text DEFAULT '' NOT NULL,
	`captured_at` text,
	`width` integer,
	`height` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_candidates_dad_media` ON `photo_candidates` (`dad`,`google_media_id`);--> statement-breakpoint
CREATE INDEX `idx_candidates_user_dad_status` ON `photo_candidates` (`user_id`,`dad`,`status`);--> statement-breakpoint
CREATE TABLE `picker_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`google_session_id` text NOT NULL,
	`user_id` text NOT NULL,
	`dad` text NOT NULL,
	`status` text NOT NULL,
	`next_page_token` text,
	`imported_count` integer DEFAULT 0 NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_picker_sessions_user` ON `picker_sessions` (`user_id`,`created_at`);