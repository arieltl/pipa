import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/**
 * Database schema. Conventions (see AGENTS.md / architecture plan):
 * - Money stored as integer minor units + a sibling currency text column.
 * - Dates: invoice dates as `YYYY-MM-DD`; timestamps as ISO strings.
 * - `created_at` / `updated_at` are app-managed ISO strings, not SQL defaults,
 *   so they stay true ISO (with the `T`/`Z`) rather than SQLite's space form.
 *
 * Phase 2 introduces the tables needed for issuer settings and clients.
 * Invoice/items/files tables arrive in later phases.
 */

export const numberingProfiles = sqliteTable("numbering_profiles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  /** Pattern with tokens like {CLIENT_CODE}-{YYYYMM}-{SEQ:02}. */
  pattern: text("pattern").notNull(),
  /** never | yearly | monthly | daily */
  resetPeriod: text("reset_period").notNull().default("monthly"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const issuerSettings = sqliteTable("issuer_settings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  legalName: text("legal_name"),
  cnpj: text("cnpj"),
  address: text("address"),
  email: text("email"),
  bankBeneficiary: text("bank_beneficiary"),
  bankBeneficiaryAddress: text("bank_beneficiary_address"),
  bankAccountNumber: text("bank_account_number"),
  bankIban: text("bank_iban"),
  bankSwiftCode: text("bank_swift_code"),
  bankName: text("bank_name"),
  bankAddress: text("bank_address"),
  bankDetails: text("bank_details"),
  pixKey: text("pix_key"),
  defaultCurrency: text("default_currency").notNull().default("GBP"),
  defaultPdfFilenameTemplate: text("default_pdf_filename_template"),
  partyFieldsJson: text("party_fields_json").notNull().default("[]"),
  defaultPdfTemplateId: integer("default_pdf_template_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const clients = sqliteTable(
  "clients",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    legalName: text("legal_name"),
    /** Short code used in invoice numbers, filenames, and templates. */
    code: text("code").notNull(),
    address: text("address"),
    country: text("country"),
    email: text("email"),
    defaultCurrency: text("default_currency").notNull().default("GBP"),
    /** At most one client is the default, preselected in the global create flow. */
    isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
    /** Default fixed monthly value in minor units of defaultCurrency. */
    defaultFixedMonthlyValue: integer("default_fixed_monthly_value"),
    defaultFixedMonthlyItemNameTemplate: text(
      "default_fixed_monthly_item_name_template",
    ),
    defaultNfseDescriptionTemplate: text("default_nfse_description_template"),
    defaultPdfFilenameTemplate: text("default_pdf_filename_template"),
    numberingProfileId: integer("numbering_profile_id").references(
      () => numberingProfiles.id,
      { onDelete: "set null" },
    ),
    partyFieldsJson: text("party_fields_json").notNull().default("[]"),
    defaultPdfTemplateId: integer("default_pdf_template_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("clients_code_unique").on(table.code)],
);

/**
 * Commercial invoices. `number` is the per-client generated (or manually
 * entered) identifier; `invoiceDate` is the date shown on the PDF while
 * `createdAt` is the real DB timestamp (spec §4.2 — these are different).
 * Currency is snapshotted at creation. Totals are derived from items, not
 * stored. `nfseDescription` is filled by the Phase 4 template flow.
 */
export const invoices = sqliteTable(
  "invoices",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),
    number: text("number").notNull(),
    /** Profile used to allocate the number; null for manual numbers. */
    numberingProfileId: integer("numbering_profile_id").references(
      () => numberingProfiles.id,
      { onDelete: "set null" },
    ),
    /** Date shown on the PDF, `YYYY-MM-DD`. */
    invoiceDate: text("invoice_date").notNull(),
    currency: text("currency").notNull().default("GBP"),
    /** draft | sent | paid | void */
    status: text("status").notNull().default("draft"),
    /** Final/editable nota fiscal description text (Phase 4). */
    nfseDescription: text("nfse_description"),
    /** Frozen "exact PDF that was sent" archive (Phase 5); null until archived. */
    archivedPdfFileId: integer("archived_pdf_file_id").references(
      () => files.id,
      { onDelete: "set null" },
    ),
    notes: text("notes"),
    issuerSnapshotJson: text("issuer_snapshot_json"),
    clientSnapshotJson: text("client_snapshot_json"),
    pdfTemplateRevisionId: integer("pdf_template_revision_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("invoices_number_unique").on(table.number),
    uniqueIndex("invoices_client_number_unique").on(
      table.clientId,
      table.number,
    ),
    index("invoices_client_idx").on(table.clientId),
  ],
);

export const pdfTemplates = sqliteTable("pdf_templates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  stableKey: text("stable_key").unique(),
  name: text("name").notNull(),
  engine: text("engine").notNull(),
  sourceKind: text("source_kind").notNull(),
  currentRevisionId: integer("current_revision_id"),
  archivedAt: text("archived_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const pdfTemplateRevisions = sqliteTable(
  "pdf_template_revisions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    templateId: integer("template_id").notNull().references(() => pdfTemplates.id, { onDelete: "restrict" }),
    revision: integer("revision").notNull(),
    rendererKey: text("renderer_key"),
    source: text("source"),
    configurationJson: text("configuration_json").notNull().default("{}"),
    contentSha256: text("content_sha256").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [uniqueIndex("pdf_template_revisions_template_revision_unique").on(table.templateId, table.revision)],
);

export const clientTextGenerators = sqliteTable(
  "client_text_generators",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    /** nfse-description | custom */
    purpose: text("purpose").notNull().default("custom"),
    source: text("source").notNull(),
    position: integer("position").notNull().default(0),
    archivedAt: text("archived_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("client_text_generators_client_key_unique").on(table.clientId, table.key)],
);

export const invoiceGeneratedTexts = sqliteTable(
  "invoice_generated_texts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    invoiceId: integer("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
    generatorId: integer("generator_id").references(() => clientTextGenerators.id, { onDelete: "set null" }),
    generatorKey: text("generator_key").notNull(),
    generatorName: text("generator_name").notNull(),
    sourceSnapshot: text("source_snapshot").notNull(),
    content: text("content").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("invoice_generated_texts_invoice_key_unique").on(table.invoiceId, table.generatorKey)],
);

export const clientInvoiceRecordTypes = sqliteTable(
  "client_invoice_record_types",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    clientId: integer("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    /** nfse | custom; purpose affects presets/placement, never persistence. */
    purpose: text("purpose").notNull().default("custom"),
    fieldDefinitionsJson: text("field_definitions_json").notNull().default("[]"),
    attachmentDefinitionsJson: text("attachment_definitions_json").notNull().default("[]"),
    allowMultiple: integer("allow_multiple", { mode: "boolean" }).notNull().default(false),
    position: integer("position").notNull().default(0),
    archivedAt: text("archived_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("client_invoice_record_types_client_key_unique").on(table.clientId, table.key)],
);

export const invoiceRecords = sqliteTable(
  "invoice_records",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    invoiceId: integer("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
    recordTypeId: integer("record_type_id").references(() => clientInvoiceRecordTypes.id, { onDelete: "set null" }),
    recordTypeKey: text("record_type_key").notNull(),
    recordTypeName: text("record_type_name").notNull(),
    purpose: text("purpose").notNull(),
    definitionsSnapshotJson: text("definitions_snapshot_json").notNull(),
    valuesJson: text("values_json").notNull().default("{}"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("invoice_records_invoice_idx").on(table.invoiceId)],
);

export const invoiceRecordAttachments = sqliteTable(
  "invoice_record_attachments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    invoiceRecordId: integer("invoice_record_id").notNull().references(() => invoiceRecords.id, { onDelete: "cascade" }),
    definitionKey: text("definition_key"),
    storedFileId: integer("stored_file_id").notNull().references(() => files.id, { onDelete: "restrict" }),
    supersedesAttachmentId: integer("supersedes_attachment_id"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("invoice_record_attachments_record_idx").on(table.invoiceRecordId)],
);

/**
 * Invoice line items. Intentionally simple (spec §8): name + value, no
 * quantity/unit price/tax. `value` is integer minor units in the invoice's
 * currency. `source` records origin (fixed_monthly | expense | other). Item
 * values are concrete historical snapshots, never live references.
 */
export const invoiceItems = sqliteTable(
  "invoice_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    invoiceId: integer("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    value: integer("value").notNull(),
    /** fixed_monthly | expense | other */
    source: text("source").notNull().default("other"),
    notes: text("notes"),
    /** Display order within the invoice. */
    position: integer("position").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("invoice_items_invoice_idx").on(table.invoiceId)],
);

/**
 * Per-client, per-profile, per-period sequence counters. Allocation reads and
 * increments `nextSeq` inside a transaction (spec §11). `periodKey` is the
 * bucket from {@link periodKeyFor} ("all" | "2026" | "2026-06" | "2026-06-20").
 */
export const invoiceSequences = sqliteTable(
  "invoice_sequences",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    numberingProfileId: integer("numbering_profile_id")
      .notNull()
      .references(() => numberingProfiles.id, { onDelete: "cascade" }),
    periodKey: text("period_key").notNull(),
    /** Next sequence value to hand out (1-based). */
    nextSeq: integer("next_seq").notNull().default(1),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("invoice_sequences_unique").on(
      table.clientId,
      table.numberingProfileId,
      table.periodKey,
    ),
  ],
);

/**
 * Append-only stored files (spec §24 `files`, §21 immutability rules). Rows are
 * never overwritten: re-archiving writes a new file and points the old row's
 * `supersededByFileId` at the replacement. `deletedAt` is a logical delete; the
 * bytes on disk stay put. `storedPath` is computed by the app, never derived
 * from an uploaded filename (which is kept only as `originalFilename` metadata).
 */
export const files = sqliteTable("files", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** archived_invoice | nfse_pdf | nfse_xml | ... */
  kind: text("kind").notNull(),
  /** Uploaded name, metadata only — never trusted as a path. */
  originalFilename: text("original_filename"),
  /** App-chosen path relative to FILES_DIR. */
  storedPath: text("stored_path").notNull(),
  mimeType: text("mime_type"),
  sizeBytes: integer("size_bytes").notNull(),
  sha256: text("sha256").notNull(),
  /** Logical delete marker; the file on disk is retained. */
  deletedAt: text("deleted_at"),
  /** Set when a newer file supersedes this one (instead of overwriting). */
  supersededByFileId: integer("superseded_by_file_id"),
  createdAt: text("created_at").notNull(),
});

/**
 * Brazilian nota fiscal / NFS-e linked to an invoice after it is issued outside
 * the app (spec §15–16, §24 `nota_fiscal_links`). At most one per invoice.
 * Optional PDF/XML attachments reference {@link files}.
 */
export const notaFiscalLinks = sqliteTable(
  "nota_fiscal_links",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    invoiceId: integer("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    nfNumber: text("nf_number"),
    issueDate: text("issue_date"),
    verificationCode: text("verification_code"),
    publicUrl: text("public_url"),
    pdfFileId: integer("pdf_file_id").references(() => files.id, {
      onDelete: "set null",
    }),
    xmlFileId: integer("xml_file_id").references(() => files.id, {
      onDelete: "set null",
    }),
    notes: text("notes"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("nota_fiscal_links_invoice_unique").on(table.invoiceId),
  ],
);

export type NumberingProfile = typeof numberingProfiles.$inferSelect;
export type NewNumberingProfile = typeof numberingProfiles.$inferInsert;
export type IssuerSettings = typeof issuerSettings.$inferSelect;
export type NewIssuerSettings = typeof issuerSettings.$inferInsert;
export type Client = typeof clients.$inferSelect;
export type NewClient = typeof clients.$inferInsert;
export type Invoice = typeof invoices.$inferSelect;
export type NewInvoice = typeof invoices.$inferInsert;
export type InvoiceItem = typeof invoiceItems.$inferSelect;
export type NewInvoiceItem = typeof invoiceItems.$inferInsert;
export type InvoiceSequence = typeof invoiceSequences.$inferSelect;
export type NewInvoiceSequence = typeof invoiceSequences.$inferInsert;
export type FileRecord = typeof files.$inferSelect;
export type NewFileRecord = typeof files.$inferInsert;
export type NotaFiscalLink = typeof notaFiscalLinks.$inferSelect;
export type NewNotaFiscalLink = typeof notaFiscalLinks.$inferInsert;
export type PdfTemplate = typeof pdfTemplates.$inferSelect;
export type PdfTemplateRevision = typeof pdfTemplateRevisions.$inferSelect;
export type ClientTextGenerator = typeof clientTextGenerators.$inferSelect;
export type NewClientTextGenerator = typeof clientTextGenerators.$inferInsert;
export type InvoiceGeneratedText = typeof invoiceGeneratedTexts.$inferSelect;
export type ClientInvoiceRecordType = typeof clientInvoiceRecordTypes.$inferSelect;
export type NewClientInvoiceRecordType = typeof clientInvoiceRecordTypes.$inferInsert;
export type InvoiceRecord = typeof invoiceRecords.$inferSelect;
export type InvoiceRecordAttachment = typeof invoiceRecordAttachments.$inferSelect;
