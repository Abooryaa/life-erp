CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`location` text,
	`kind` text DEFAULT 'other' NOT NULL,
	`date` text NOT NULL,
	`end_date` text,
	`all_day` integer DEFAULT false NOT NULL,
	`start_time` text,
	`end_time` text,
	`workspace_id` text,
	`person_id` text,
	`recurrence` text,
	`recurrence_interval` integer DEFAULT 1 NOT NULL,
	`recurrence_until` text,
	`reminder_minutes` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `events_date_idx` ON `events` (`date`);--> statement-breakpoint
CREATE TABLE `goal_checkins` (
	`id` text PRIMARY KEY NOT NULL,
	`goal_id` text NOT NULL,
	`date` text NOT NULL,
	`value` real NOT NULL,
	`note` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`goal_id`) REFERENCES `goals`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `goals` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_id` text,
	`level` text DEFAULT 'objective' NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`area` text,
	`metric` text DEFAULT 'none' NOT NULL,
	`start_value` real DEFAULT 0 NOT NULL,
	`target_value` real,
	`current_value` real,
	`unit` text,
	`savings_goal_id` text,
	`start_date` text,
	`deadline` text,
	`priority` integer DEFAULT 2 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`workspace_id` text,
	`color` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`savings_goal_id`) REFERENCES `savings_goals`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `goals_parent_idx` ON `goals` (`parent_id`);--> statement-breakpoint
CREATE TABLE `idempotency_keys` (
	`key` text PRIMARY KEY NOT NULL,
	`status` integer NOT NULL,
	`body` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `interactions` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`kind` text NOT NULL,
	`date` text NOT NULL,
	`summary` text NOT NULL,
	`workspace_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `interactions_person_idx` ON `interactions` (`person_id`,`date`);--> statement-breakpoint
CREATE TABLE `notes` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`workspace_id` text,
	`pinned` integer DEFAULT false NOT NULL,
	`archived_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `people` (
	`id` text PRIMARY KEY NOT NULL,
	`full_name` text NOT NULL,
	`nickname` text,
	`relationship` text DEFAULT 'other' NOT NULL,
	`company` text,
	`role` text,
	`phone` text,
	`phone2` text,
	`email` text,
	`city` text,
	`birthday` text,
	`linkedin` text,
	`instagram` text,
	`website` text,
	`source` text,
	`workspace_id` text,
	`next_follow_up` text,
	`follow_up_note` text,
	`notes` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `people_followup_idx` ON `people` (`next_follow_up`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'inbox' NOT NULL,
	`priority` integer DEFAULT 3 NOT NULL,
	`area` text,
	`due_date` text,
	`due_time` text,
	`start_date` text,
	`completed_at` text,
	`workspace_id` text,
	`project_id` text,
	`goal_id` text,
	`person_id` text,
	`assignee` text,
	`recurrence` text,
	`recurrence_interval` integer DEFAULT 1 NOT NULL,
	`source` text,
	`sort_order` real DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`goal_id`) REFERENCES `goals`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `tasks_status_idx` ON `tasks` (`status`,`due_date`);--> statement-breakpoint
CREATE INDEX `tasks_ws_idx` ON `tasks` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `tasks_goal_idx` ON `tasks` (`goal_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_source_unique` ON `tasks` (`source`);