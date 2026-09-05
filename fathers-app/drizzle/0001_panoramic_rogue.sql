CREATE TABLE `google_app_settings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`encrypted_client_secret` text NOT NULL,
	`secret_iv` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
