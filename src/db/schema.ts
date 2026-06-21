import {
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
  bankDetails: text("bank_details"),
  pixKey: text("pix_key"),
  defaultCurrency: text("default_currency").notNull().default("GBP"),
  defaultPdfFilenameTemplate: text("default_pdf_filename_template"),
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
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("clients_code_unique").on(table.code)],
);

export type NumberingProfile = typeof numberingProfiles.$inferSelect;
export type NewNumberingProfile = typeof numberingProfiles.$inferInsert;
export type IssuerSettings = typeof issuerSettings.$inferSelect;
export type NewIssuerSettings = typeof issuerSettings.$inferInsert;
export type Client = typeof clients.$inferSelect;
export type NewClient = typeof clients.$inferInsert;
