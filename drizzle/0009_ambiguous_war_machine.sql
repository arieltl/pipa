CREATE TABLE `invoice_edit_generations` (
	`session_id` text NOT NULL,
	`generation` integer NOT NULL,
	`invoice_revision` integer NOT NULL,
	`snapshot_json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `invoice_edit_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_edit_generations_session_generation_unique` ON `invoice_edit_generations` (`session_id`,`generation`);--> statement-breakpoint
CREATE TABLE `invoice_edit_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` integer NOT NULL,
	`current_generation` integer DEFAULT 1 NOT NULL,
	`state` text DEFAULT 'active' NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `invoice_edit_sessions_invoice_idx` ON `invoice_edit_sessions` (`invoice_id`);--> statement-breakpoint
CREATE TABLE `invoice_file_ownership` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invoice_id` integer NOT NULL,
	`file_id` integer NOT NULL,
	`purpose` text NOT NULL,
	`provenance_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_file_ownership_invoice_file_unique` ON `invoice_file_ownership` (`invoice_id`,`file_id`);--> statement-breakpoint
CREATE INDEX `invoice_file_ownership_invoice_idx` ON `invoice_file_ownership` (`invoice_id`);--> statement-breakpoint
CREATE TABLE `invoice_operations` (
	`id` text NOT NULL,
	`invoice_id` integer NOT NULL,
	`session_id` text,
	`kind` text NOT NULL,
	`digest` text NOT NULL,
	`state` text NOT NULL,
	`fencing_generation` integer DEFAULT 1 NOT NULL,
	`lease_expires_at` text,
	`result_json` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_operations_invoice_id_unique` ON `invoice_operations` (`invoice_id`,`id`);--> statement-breakpoint
CREATE INDEX `invoice_operations_invoice_idx` ON `invoice_operations` (`invoice_id`);--> statement-breakpoint
CREATE TABLE `invoice_pdf_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invoice_id` integer NOT NULL,
	`file_id` integer NOT NULL,
	`source_revision` integer NOT NULL,
	`source_status` text NOT NULL,
	`invoice_number` text NOT NULL,
	`template_revision_id` integer,
	`dependency_signature` text NOT NULL,
	`fingerprint_version` integer DEFAULT 1 NOT NULL,
	`saved_at` text NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `invoice_pdf_versions_invoice_idx` ON `invoice_pdf_versions` (`invoice_id`);--> statement-breakpoint
CREATE TABLE `invoice_previews` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` integer NOT NULL,
	`session_id` text,
	`workspace_revision` integer NOT NULL,
	`base_generation` integer,
	`source_kind` text NOT NULL,
	`input_digest` text NOT NULL,
	`dependency_signature` text NOT NULL,
	`file_id` integer NOT NULL,
	`byte_hash` text NOT NULL,
	`expires_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `invoice_previews_invoice_idx` ON `invoice_previews` (`invoice_id`);--> statement-breakpoint
CREATE TABLE `invoice_rebases` (
	`id` text NOT NULL,
	`session_id` text NOT NULL,
	`digest` text NOT NULL,
	`state` text NOT NULL,
	`from_generation` integer NOT NULL,
	`to_generation` integer,
	`result_json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `invoice_edit_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_rebases_session_id_unique` ON `invoice_rebases` (`session_id`,`id`);--> statement-breakpoint
CREATE TABLE `invoice_staged_files` (
	`token` text PRIMARY KEY NOT NULL,
	`upload_id` text NOT NULL,
	`session_id` text NOT NULL,
	`invoice_id` integer NOT NULL,
	`record_key` text NOT NULL,
	`definition_key` text NOT NULL,
	`digest` text NOT NULL,
	`stored_path` text NOT NULL,
	`original_filename` text NOT NULL,
	`mime_type` text,
	`size_bytes` integer NOT NULL,
	`state` text DEFAULT 'staged' NOT NULL,
	`fencing_generation` integer,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `invoice_edit_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_staged_files_session_upload_unique` ON `invoice_staged_files` (`session_id`,`upload_id`);--> statement-breakpoint
ALTER TABLE `invoice_records` ADD `removed_at` text;--> statement-breakpoint
ALTER TABLE `invoices` ADD `workspace_revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE TEMP TABLE `_workspace_proven_ownership` (`invoice_id` integer NOT NULL, `file_id` integer NOT NULL, `purpose` text NOT NULL, `provenance_json` text NOT NULL, `created_at` text NOT NULL);--> statement-breakpoint
INSERT INTO `_workspace_proven_ownership`
WITH RECURSIVE roots(invoice_id,file_id) AS (
  SELECT i.id,i.archived_pdf_file_id FROM invoices i WHERE i.archived_pdf_file_id IS NOT NULL
  UNION SELECT n.invoice_id,n.pdf_file_id FROM nota_fiscal_links n WHERE n.pdf_file_id IS NOT NULL
  UNION SELECT n.invoice_id,n.xml_file_id FROM nota_fiscal_links n WHERE n.xml_file_id IS NOT NULL
  UNION SELECT r.invoice_id,a.stored_file_id FROM invoice_record_attachments a JOIN invoice_records r ON r.id=a.invoice_record_id
), ownership(invoice_id,file_id) AS (
  SELECT * FROM roots
  UNION
  SELECT o.invoice_id,f.id
  FROM ownership o JOIN files f ON f.superseded_by_file_id=o.file_id
)
SELECT DISTINCT o.invoice_id,o.file_id,'retained_history','{"source":"verified_relationship"}',f.created_at FROM ownership o JOIN files f ON f.id=o.file_id;--> statement-breakpoint
CREATE TEMP TABLE `_workspace_ownership_gate` (`ok` integer NOT NULL CHECK (`ok` = 1));--> statement-breakpoint
INSERT INTO `_workspace_ownership_gate`
SELECT CASE WHEN EXISTS (SELECT 1 FROM `_workspace_proven_ownership` GROUP BY file_id HAVING count(DISTINCT invoice_id) > 1) THEN 0 ELSE 1 END;--> statement-breakpoint
INSERT OR IGNORE INTO `invoice_file_ownership` (`invoice_id`,`file_id`,`purpose`,`provenance_json`,`created_at`)
SELECT invoice_id,file_id,purpose,provenance_json,created_at FROM `_workspace_proven_ownership`;--> statement-breakpoint
DROP TABLE `_workspace_ownership_gate`;--> statement-breakpoint
DROP TABLE `_workspace_proven_ownership`;--> statement-breakpoint
SELECT 1;
