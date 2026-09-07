CREATE TABLE `client_text_generators` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` integer NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`purpose` text DEFAULT 'custom' NOT NULL,
	`source` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `client_text_generators_client_key_unique` ON `client_text_generators` (`client_id`,`key`);--> statement-breakpoint
CREATE TABLE `invoice_generated_texts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invoice_id` integer NOT NULL,
	`generator_id` integer,
	`generator_key` text NOT NULL,
	`generator_name` text NOT NULL,
	`source_snapshot` text NOT NULL,
	`content` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`generator_id`) REFERENCES `client_text_generators`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_generated_texts_invoice_key_unique` ON `invoice_generated_texts` (`invoice_id`,`generator_key`);
--> statement-breakpoint
INSERT INTO `client_text_generators` (`client_id`,`key`,`name`,`purpose`,`source`,`position`,`created_at`,`updated_at`)
SELECT `id`,'nfse_description','NFS-e description','nfse-description',`default_nfse_description_template`,0,
  strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM `clients` WHERE trim(coalesce(`default_nfse_description_template`,''))<>'';
--> statement-breakpoint
INSERT INTO `invoice_generated_texts` (`invoice_id`,`generator_id`,`generator_key`,`generator_name`,`source_snapshot`,`content`,`created_at`,`updated_at`)
SELECT i.`id`,g.`id`,'nfse_description','NFS-e description',coalesce(g.`source`,''),i.`nfse_description`,i.`created_at`,i.`updated_at`
FROM `invoices` i
LEFT JOIN `client_text_generators` g ON g.`client_id`=i.`client_id` AND g.`key`='nfse_description'
WHERE trim(coalesce(i.`nfse_description`,''))<>'';
