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

  if (existing) {
    return db
      .update(issuerSettings)
      .set({ ...input, updatedAt: now })
      .where(eq(issuerSettings.id, existing.id))
      .returning()
      .get();
  }

  return db
    .insert(issuerSettings)
    .values({ ...input, createdAt: now, updatedAt: now })
    .returning()
    .get();
}
