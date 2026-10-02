CREATE TABLE `ai_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`at` text NOT NULL,
	`purpose` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`question` text NOT NULL,
	`tools` text DEFAULT '[]' NOT NULL,
	`data_chars` integer DEFAULT 0 NOT NULL,
	`input_tokens` integer,
	`output_tokens` integer,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`answer` text
);
--> statement-breakpoint
CREATE INDEX `ai_calls_at_idx` ON `ai_calls` (`at`);--> statement-breakpoint
CREATE TABLE `secrets` (
	`name` text PRIMARY KEY NOT NULL,
	`ciphertext` text NOT NULL,
	`iv` text NOT NULL,
	`tag` text NOT NULL,
	`hint` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
