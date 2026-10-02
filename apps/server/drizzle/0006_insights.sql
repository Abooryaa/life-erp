CREATE TABLE `asset_valuations` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`date` text NOT NULL,
	`value` integer NOT NULL,
	`note` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `asset_val_idx` ON `asset_valuations` (`asset_id`,`date`);--> statement-breakpoint
CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`liquidity` text DEFAULT 'non_liquid' NOT NULL,
	`workspace_id` text,
	`currency` text DEFAULT 'EGP' NOT NULL,
	`purchase_date` text,
	`purchase_price` integer,
	`quantity` real,
	`unit` text,
	`include_in_net_worth` integer DEFAULT true NOT NULL,
	`disposed_at` text,
	`disposed_value` integer,
	`notes` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `net_worth_snapshots` (
	`date` text PRIMARY KEY NOT NULL,
	`base` text NOT NULL,
	`liquid` integer NOT NULL,
	`investments` integer NOT NULL,
	`other_assets` integer NOT NULL,
	`liabilities` integer NOT NULL,
	`net_worth` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`wins` text,
	`challenges` text,
	`lessons` text,
	`priorities` text,
	`rating` integer,
	`metrics` text,
	`completed_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reviews_period_uq` ON `reviews` (`type`,`period_start`);--> statement-breakpoint
CREATE TABLE `scenarios` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`horizon_months` integer DEFAULT 12 NOT NULL,
	`monthly_income` integer,
	`monthly_expenses` integer,
	`start_balance` integer,
	`adjustments` text DEFAULT '[]' NOT NULL,
	`notes` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text
);
