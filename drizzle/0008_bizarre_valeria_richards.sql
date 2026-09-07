CREATE TABLE `client_invoice_record_types` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` integer NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`purpose` text DEFAULT 'custom' NOT NULL,
	`field_definitions_json` text DEFAULT '[]' NOT NULL,
	`attachment_definitions_json` text DEFAULT '[]' NOT NULL,
	`allow_multiple` integer DEFAULT false NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `client_invoice_record_types_client_key_unique` ON `client_invoice_record_types` (`client_id`,`key`);--> statement-breakpoint
CREATE TABLE `invoice_record_attachments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invoice_record_id` integer NOT NULL,
	`definition_key` text,
	`stored_file_id` integer NOT NULL,
	`supersedes_attachment_id` integer,
	`created_at` text NOT NULL,
	FOREIGN KEY (`invoice_record_id`) REFERENCES `invoice_records`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`stored_file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `invoice_record_attachments_record_idx` ON `invoice_record_attachments` (`invoice_record_id`);--> statement-breakpoint
CREATE TABLE `invoice_records` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invoice_id` integer NOT NULL,
	`record_type_id` integer,
	`record_type_key` text NOT NULL,
	`record_type_name` text NOT NULL,
	`purpose` text NOT NULL,
	`definitions_snapshot_json` text NOT NULL,
	`values_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`record_type_id`) REFERENCES `client_invoice_record_types`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `invoice_records_invoice_idx` ON `invoice_records` (`invoice_id`);
--> statement-breakpoint
INSERT INTO client_invoice_record_types
  (client_id, key, name, purpose, field_definitions_json, attachment_definitions_json, allow_multiple, position, created_at, updated_at)
SELECT c.id, 'nfse', 'NFS-e', 'nfse',
  '[{"key":"number","label":"NFS-e number","kind":"text","required":false,"choices":[]},{"key":"issue_date","label":"Issue date","kind":"date","required":false,"choices":[]},{"key":"verification_code","label":"Verification code","kind":"text","required":false,"choices":[]},{"key":"public_url","label":"Public URL","kind":"url","required":false,"choices":[]},{"key":"notes","label":"Notes","kind":"multiline","required":false,"choices":[]}]',
  '[{"key":"pdf","label":"PDF","acceptedTypes":["application/pdf"],"maximumCount":1,"required":false},{"key":"xml","label":"XML","acceptedTypes":["application/xml","text/xml"],"maximumCount":1,"required":false}]',
  false, 0, datetime('now'), datetime('now')
FROM clients c
WHERE EXISTS (SELECT 1 FROM invoices i JOIN nota_fiscal_links n ON n.invoice_id = i.id WHERE i.client_id = c.id)
   OR EXISTS (SELECT 1 FROM client_text_generators g WHERE g.client_id = c.id AND g.purpose = 'nfse-description');
--> statement-breakpoint
INSERT INTO invoice_records
  (invoice_id, record_type_id, record_type_key, record_type_name, purpose, definitions_snapshot_json, values_json, created_at, updated_at)
SELECT n.invoice_id, rt.id, 'nfse', 'NFS-e', 'nfse',
  json_object('fields', json(rt.field_definitions_json), 'attachments', json(rt.attachment_definitions_json)),
  json_object('number', coalesce(n.nf_number, ''), 'issue_date', coalesce(n.issue_date, ''), 'verification_code', coalesce(n.verification_code, ''), 'public_url', coalesce(n.public_url, ''), 'notes', coalesce(n.notes, '')),
  n.created_at, n.updated_at
FROM nota_fiscal_links n
JOIN invoices i ON i.id = n.invoice_id
JOIN client_invoice_record_types rt ON rt.client_id = i.client_id AND rt.key = 'nfse';
--> statement-breakpoint
INSERT INTO invoice_record_attachments
  (invoice_record_id, definition_key, stored_file_id, supersedes_attachment_id, created_at)
SELECT r.id, 'pdf', n.pdf_file_id, NULL, n.created_at
FROM nota_fiscal_links n JOIN invoice_records r ON r.invoice_id = n.invoice_id AND r.purpose = 'nfse'
WHERE n.pdf_file_id IS NOT NULL;
--> statement-breakpoint
INSERT INTO invoice_record_attachments
  (invoice_record_id, definition_key, stored_file_id, supersedes_attachment_id, created_at)
SELECT r.id, 'xml', n.xml_file_id, NULL, n.created_at
FROM nota_fiscal_links n JOIN invoice_records r ON r.invoice_id = n.invoice_id AND r.purpose = 'nfse'
WHERE n.xml_file_id IS NOT NULL;
