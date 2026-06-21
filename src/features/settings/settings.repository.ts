import { eq } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { issuerSettings, type IssuerSettings } from "../../db/schema.ts";
import { nowIso } from "../../domain/dates.ts";
import type { IssuerFormInput } from "./settings.schema.ts";

/** Issuer settings are a singleton row. */
export function getIssuerSettings(): IssuerSettings | null {
  return db.select().from(issuerSettings).limit(1).get() ?? null;
}

/** Insert on first save, update thereafter. Returns the persisted row. */
export function saveIssuerSettings(input: IssuerFormInput): IssuerSettings {
  const existing = getIssuerSettings();
  const now = nowIso();
  const values = normalizeIssuerSettingsInput(input);

  if (existing) {
    return db
      .update(issuerSettings)
      .set({ ...values, updatedAt: now })
      .where(eq(issuerSettings.id, existing.id))
      .returning()
      .get();
  }

  return db
    .insert(issuerSettings)
    .values({ ...values, createdAt: now, updatedAt: now })
    .returning()
    .get();
}

function nullable(value: string | undefined): string | null {
  return value ?? null;
}

function normalizeIssuerSettingsInput(input: IssuerFormInput) {
  return {
    name: input.name,
    legalName: nullable(input.legalName),
    cnpj: nullable(input.cnpj),
    address: nullable(input.address),
    email: nullable(input.email),
    bankBeneficiary: nullable(input.bankBeneficiary),
    bankBeneficiaryAddress: nullable(input.bankBeneficiaryAddress),
    bankAccountNumber: null,
    bankIban: nullable(input.bankIban),
    bankSwiftCode: nullable(input.bankSwiftCode),
    bankName: nullable(input.bankName),
    bankAddress: nullable(input.bankAddress),
    bankDetails: nullable(input.bankDetails),
    pixKey: nullable(input.pixKey),
    defaultCurrency: input.defaultCurrency,
    defaultPdfFilenameTemplate: nullable(input.defaultPdfFilenameTemplate),
  };
}
