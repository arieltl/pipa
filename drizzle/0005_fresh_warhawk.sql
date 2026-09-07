CREATE TABLE `pdf_template_revisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`template_id` integer NOT NULL,
	`revision` integer NOT NULL,
	`renderer_key` text,
	`source` text,
	`configuration_json` text DEFAULT '{}' NOT NULL,
	`content_sha256` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`template_id`) REFERENCES `pdf_templates`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pdf_template_revisions_template_revision_unique` ON `pdf_template_revisions` (`template_id`,`revision`);--> statement-breakpoint
CREATE TABLE `pdf_templates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`stable_key` text,
	`name` text NOT NULL,
	`engine` text NOT NULL,
	`source_kind` text NOT NULL,
	`current_revision_id` integer,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pdf_templates_stable_key_unique` ON `pdf_templates` (`stable_key`);--> statement-breakpoint
ALTER TABLE `clients` ADD `party_fields_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `clients` ADD `default_pdf_template_id` integer;--> statement-breakpoint
ALTER TABLE `invoices` ADD `issuer_snapshot_json` text;--> statement-breakpoint
ALTER TABLE `invoices` ADD `client_snapshot_json` text;--> statement-breakpoint
ALTER TABLE `invoices` ADD `pdf_template_revision_id` integer;--> statement-breakpoint
ALTER TABLE `issuer_settings` ADD `party_fields_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `issuer_settings` ADD `default_pdf_template_id` integer;--> statement-breakpoint

INSERT INTO `pdf_templates` (`stable_key`,`name`,`engine`,`source_kind`,`created_at`,`updated_at`)
VALUES ('builtin-react-classic','Classic','react-pdf','builtin','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');--> statement-breakpoint
INSERT INTO `pdf_template_revisions` (`template_id`,`revision`,`renderer_key`,`configuration_json`,`content_sha256`,`created_at`)
SELECT `id`,1,'classic','{}','builtin-react-classic-v1','2026-01-01T00:00:00.000Z' FROM `pdf_templates` WHERE `stable_key`='builtin-react-classic';--> statement-breakpoint
UPDATE `pdf_templates` SET `current_revision_id`=(SELECT `id` FROM `pdf_template_revisions` WHERE `renderer_key`='classic' LIMIT 1) WHERE `stable_key`='builtin-react-classic';--> statement-breakpoint

UPDATE `issuer_settings` SET `party_fields_json` = json_array(
  json_object('key','legal_name','definitionKey','legal_name','label','Legal name','value',coalesce(`legal_name`,''),'section','identity','visibility','document','position',0),
  json_object('key','br_cnpj','definitionKey','br_cnpj','label','CNPJ','value',coalesce(`cnpj`,''),'section','identity','visibility','document','position',1),
  json_object('key','email','definitionKey','email','label','Email','value',coalesce(`email`,''),'section','contact','visibility','document','position',0),
  json_object('key','address','definitionKey','address','label','Address','value',coalesce(`address`,''),'section','address','visibility','document','position',0),
  json_object('key','payment_beneficiary','definitionKey','payment_beneficiary','label','Beneficiary','value',coalesce(`bank_beneficiary`,''),'section','payment','visibility','document','position',0),
  json_object('key','beneficiary_address','definitionKey','beneficiary_address','label','Beneficiary address','value',coalesce(`bank_beneficiary_address`,''),'section','payment','visibility','document','position',1),
  json_object('key','account_number','definitionKey','account_number','label','Account number','value',coalesce(`bank_account_number`,''),'section','payment','visibility','document','position',2),
  json_object('key','iban','definitionKey','iban','label','IBAN','value',coalesce(`bank_iban`,''),'section','payment','visibility','document','position',3),
  json_object('key','swift_bic','definitionKey','swift_bic','label','SWIFT / BIC','value',coalesce(`bank_swift_code`,''),'section','payment','visibility','document','position',4),
  json_object('key','bank_name','definitionKey','bank_name','label','Bank name','value',coalesce(`bank_name`,''),'section','payment','visibility','document','position',5),
  json_object('key','bank_address','definitionKey','bank_address','label','Bank address','value',coalesce(`bank_address`,''),'section','payment','visibility','document','position',6),
  json_object('key','payment_instructions','definitionKey','payment_instructions','label','Payment instructions','value',coalesce(`bank_details`,''),'section','payment','visibility','document','position',7),
  json_object('key','pix','definitionKey','pix','label','PIX','value',coalesce(`pix_key`,''),'section','payment','visibility','document','position',8)
), `default_pdf_template_id`=(SELECT `id` FROM `pdf_templates` WHERE `stable_key`='builtin-react-classic');--> statement-breakpoint

UPDATE `clients` SET `party_fields_json` = json_array(
  json_object('key','legal_name','definitionKey','legal_name','label','Legal name','value',coalesce(`legal_name`,''),'section','identity','visibility','document','position',0),
  json_object('key','email','definitionKey','email','label','Email','value',coalesce(`email`,''),'section','contact','visibility','document','position',0),
  json_object('key','address','definitionKey','address','label','Address','value',coalesce(`address`,''),'section','address','visibility','document','position',0),
  json_object('key','country','definitionKey','country','label','Country','value',coalesce(`country`,''),'section','address','visibility','document','position',1)
);--> statement-breakpoint

UPDATE `invoices` SET
  `issuer_snapshot_json`=coalesce((SELECT json_object('name',s.`name`,'fields',json(coalesce((SELECT json_group_array(json(f.value)) FROM json_each(s.`party_fields_json`) f WHERE trim(json_extract(f.value,'$.value'))<>'' AND json_extract(f.value,'$.visibility')='document'),'[]'))) FROM `issuer_settings` s LIMIT 1), json_object('name','Invoice','fields',json_array())),
  `client_snapshot_json`=(SELECT json_object('name',c.`name`,'code',c.`code`,'fields',json(coalesce((SELECT json_group_array(json(f.value)) FROM json_each(c.`party_fields_json`) f WHERE trim(json_extract(f.value,'$.value'))<>'' AND json_extract(f.value,'$.visibility')='document'),'[]'))) FROM `clients` c WHERE c.`id`=`invoices`.`client_id`),
  `pdf_template_revision_id`=(SELECT `current_revision_id` FROM `pdf_templates` WHERE `stable_key`='builtin-react-classic');
