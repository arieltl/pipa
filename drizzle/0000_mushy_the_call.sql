CREATE TABLE `clients` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`legal_name` text,
	`code` text NOT NULL,
	`address` text,
	`country` text,
	`email` text,
	`default_currency` text DEFAULT 'GBP' NOT NULL,
	`default_fixed_monthly_value` integer,
	`default_fixed_monthly_item_name_template` text,
	`default_nfse_description_template` text,
	`default_pdf_filename_template` text,
	`numbering_profile_id` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`numbering_profile_id`) REFERENCES `numbering_profiles`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `clients_code_unique` ON `clients` (`code`);--> statement-breakpoint
CREATE TABLE `issuer_settings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`legal_name` text,
	`cnpj` text,
	`address` text,
	`email` text,
	`bank_details` text,
	`pix_key` text,
	`default_currency` text DEFAULT 'GBP' NOT NULL,
	`default_pdf_filename_template` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `numbering_profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`pattern` text NOT NULL,
	`reset_period` text DEFAULT 'monthly' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
