CREATE TABLE `invoice_deletion_receipts` (
	`invoice_id` integer NOT NULL,
	`operation_id` text NOT NULL,
	`kind` text NOT NULL,
	`digest` text NOT NULL,
	`outcome` text NOT NULL,
	`code` text,
	`message` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_deletion_receipts_invoice_operation_unique` ON `invoice_deletion_receipts` (`invoice_id`,`operation_id`);