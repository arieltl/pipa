CREATE TABLE `files` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`original_filename` text,
	`stored_path` text NOT NULL,
	`mime_type` text,
	`size_bytes` integer NOT NULL,
	`sha256` text NOT NULL,
	`deleted_at` text,
	`superseded_by_file_id` integer,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `nota_fiscal_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invoice_id` integer NOT NULL,
	`nf_number` text,
	`issue_date` text,
	`verification_code` text,
	`public_url` text,
	`pdf_file_id` integer,
	`xml_file_id` integer,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pdf_file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`xml_file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `nota_fiscal_links_invoice_unique` ON `nota_fiscal_links` (`invoice_id`);--> statement-breakpoint
ALTER TABLE `invoices` ADD `archived_pdf_file_id` integer REFERENCES files(id);