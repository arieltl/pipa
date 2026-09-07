import { eq } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { issuerSettings, type IssuerSettings } from "../../db/schema.ts";
import { nowIso } from "../../domain/dates.ts";
import type { IssuerFormInput } from "./settings.schema.ts";
import { serializePartyFields } from "../../domain/party-fields/index.ts";

/** Issuer settings are a singleton row. */
export function getIssuerSettings(): IssuerSettings | null {
  return db.select().from(issuerSettings).limit(1).get() ?? null;
}

/** Insert on first save, update thereafter. Returns the persisted row. */
export function saveIssuerSettings(input: IssuerFormInput): IssuerSettings {
  const existing = getIssuerSettings();
  const now = nowIso();
  const values = normalizeIssuerSettingsInput(input, existing?.partyFieldsJson);

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

function normalizeIssuerSettingsInput(input: IssuerFormInput, currentFields?: string) {
  return {
    name: input.name,
    defaultCurrency: input.defaultCurrency,
    defaultPdfFilenameTemplate: input.defaultPdfFilenameTemplate ?? null,
    defaultPdfTemplateId: input.defaultPdfTemplateId ?? null,
    partyFieldsJson: input.partyFields
      ? serializePartyFields(input.partyFields)
      : currentFields ?? "[]",
  };
}
