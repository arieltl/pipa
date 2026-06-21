CREATE TABLE `invoice_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invoice_id` integer NOT NULL,
	`name` text NOT NULL,
	`value` integer NOT NULL,
	`source` text DEFAULT 'other' NOT NULL,
	`notes` text,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `invoice_items_invoice_idx` ON `invoice_items` (`invoice_id`);--> statement-breakpoint
CREATE TABLE `invoice_sequences` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` integer NOT NULL,
	`numbering_profile_id` integer NOT NULL,
	`period_key` text NOT NULL,
	`next_seq` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`numbering_profile_id`) REFERENCES `numbering_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_sequences_unique` ON `invoice_sequences` (`client_id`,`numbering_profile_id`,`period_key`);--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` integer NOT NULL,
	`number` text NOT NULL,
	`numbering_profile_id` integer,
	`invoice_date` text NOT NULL,
	`currency` text DEFAULT 'GBP' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`nfse_description` text,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`numbering_profile_id`) REFERENCES `numbering_profiles`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_number_unique` ON `invoices` (`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_client_number_unique` ON `invoices` (`client_id`,`number`);--> statement-breakpoint
CREATE INDEX `invoices_client_idx` ON `invoices` (`client_id`);