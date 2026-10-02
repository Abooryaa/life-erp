CREATE TABLE `automation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`automation_id` text NOT NULL,
	`at` text NOT NULL,
	`status` text NOT NULL,
	`entity_type` text,
	`entity_id` text,
	`message` text,
	FOREIGN KEY (`automation_id`) REFERENCES `automations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `auto_runs_idx` ON `automation_runs` (`automation_id`,`at`);--> statement-breakpoint
CREATE TABLE `automations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`event` text NOT NULL,
	`schedule` text,
	`conditions` text DEFAULT '[]' NOT NULL,
	`actions` text DEFAULT '[]' NOT NULL,
	`last_scheduled` text,
	`last_run_at` text,
	`run_count` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `custom_field_defs` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`label` text NOT NULL,
	`type` text NOT NULL,
	`options` text DEFAULT '[]' NOT NULL,
	`required` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `custom_field_values` (
	`field_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`value` text NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	PRIMARY KEY(`field_id`, `entity_id`),
	FOREIGN KEY (`field_id`) REFERENCES `custom_field_defs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `cf_values_entity_idx` ON `custom_field_values` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `import_items` (
	`import_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	PRIMARY KEY(`import_id`, `entity_id`),
	FOREIGN KEY (`import_id`) REFERENCES `imports`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `import_presets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`target` text NOT NULL,
	`mapping` text NOT NULL,
	`options` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `imports` (
	`id` text PRIMARY KEY NOT NULL,
	`target` text NOT NULL,
	`file_name` text,
	`row_count` integer NOT NULL,
	`created_count` integer NOT NULL,
	`skipped_count` integer NOT NULL,
	`undone_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
