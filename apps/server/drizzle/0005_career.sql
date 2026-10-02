CREATE TABLE `achievement_skills` (
	`achievement_id` text NOT NULL,
	`skill_id` text NOT NULL,
	PRIMARY KEY(`achievement_id`, `skill_id`),
	FOREIGN KEY (`achievement_id`) REFERENCES `achievements`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `achievements` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`employment_id` text,
	`company` text,
	`role` text,
	`title` text NOT NULL,
	`description` text,
	`metric` text,
	`impact` text,
	`cv_relevance` integer DEFAULT 2 NOT NULL,
	`cv_bullet` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`employment_id`) REFERENCES `employments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `achievements_emp_idx` ON `achievements` (`employment_id`);--> statement-breakpoint
CREATE TABLE `application_statuses` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `employments` (
	`id` text PRIMARY KEY NOT NULL,
	`company` text NOT NULL,
	`organization_id` text,
	`position` text NOT NULL,
	`department` text,
	`employment_type` text DEFAULT 'full_time' NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text,
	`salary` integer,
	`currency` text DEFAULT 'EGP' NOT NULL,
	`salary_period` text DEFAULT 'monthly' NOT NULL,
	`benefits` text,
	`location` text,
	`work_schedule` text,
	`manager_name` text,
	`manager_person_id` text,
	`responsibilities` text,
	`notes` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`manager_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `interviews` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`stage` text NOT NULL,
	`date` text NOT NULL,
	`time` text,
	`mode` text DEFAULT 'video' NOT NULL,
	`location` text,
	`interviewer` text,
	`outcome` text DEFAULT 'pending' NOT NULL,
	`notes` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `job_applications`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `interviews_app_idx` ON `interviews` (`application_id`);--> statement-breakpoint
CREATE INDEX `interviews_date_idx` ON `interviews` (`date`);--> statement-breakpoint
CREATE TABLE `job_applications` (
	`id` text PRIMARY KEY NOT NULL,
	`company` text NOT NULL,
	`organization_id` text,
	`position` text NOT NULL,
	`status_id` text NOT NULL,
	`source` text,
	`url` text,
	`location` text,
	`work_mode` text,
	`applied_date` text,
	`salary_min` integer,
	`salary_max` integer,
	`currency` text DEFAULT 'EGP' NOT NULL,
	`recruiter_person_id` text,
	`follow_up_date` text,
	`cv_version` text,
	`job_description` text,
	`outcome` text,
	`priority` integer DEFAULT 2 NOT NULL,
	`closed_at` text,
	`notes` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`status_id`) REFERENCES `application_statuses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recruiter_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `apps_status_idx` ON `job_applications` (`status_id`);--> statement-breakpoint
CREATE TABLE `learning_items` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`type` text DEFAULT 'course' NOT NULL,
	`provider` text,
	`url` text,
	`skill_id` text,
	`goal_id` text,
	`status` text DEFAULT 'planned' NOT NULL,
	`start_date` text,
	`deadline` text,
	`progress` integer DEFAULT 0 NOT NULL,
	`completed_at` text,
	`cost` integer,
	`currency` text DEFAULT 'EGP' NOT NULL,
	`notes` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`goal_id`) REFERENCES `goals`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `skills` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`category` text DEFAULT 'technical' NOT NULL,
	`level` integer DEFAULT 1 NOT NULL,
	`target_level` integer,
	`last_used` text,
	`evidence` text,
	`goal_id` text,
	`notes` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`goal_id`) REFERENCES `goals`(`id`) ON UPDATE no action ON DELETE no action
);
