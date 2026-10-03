CREATE TABLE `account_interest` (
	`account_id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`frequency` text NOT NULL,
	`method` text DEFAULT 'daily_balance' NOT NULL,
	`credit_day` integer DEFAULT 31 NOT NULL,
	`category_id` text NOT NULL,
	`start_date` text NOT NULL,
	`accrued_through` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `interest_rates` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`effective_from` text NOT NULL,
	`annual_rate` real NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `interest_rates_uq` ON `interest_rates` (`account_id`,`effective_from`);--> statement-breakpoint
ALTER TABLE `transactions` ADD `interest_through` text;