import { z } from "zod";
import { documentFields, parsePartyFields, partyFieldsSchema, type PartyField } from "./index.ts";

export const invoicePartySnapshotSchema = z.object({
  name: z.string().min(1).max(200),
  code: z.string().max(30).optional(),
  fields: partyFieldsSchema,
});
export type InvoicePartySnapshot = z.infer<typeof invoicePartySnapshotSchema>;

export function createPartySnapshot(party: { name: string; code?: string; partyFieldsJson: string }): InvoicePartySnapshot {
  return invoicePartySnapshotSchema.parse({ name: party.name, ...(party.code ? { code: party.code } : {}), fields: documentFields(parsePartyFields(party.partyFieldsJson)) });
}
export function serializePartySnapshot(snapshot: InvoicePartySnapshot): string { return JSON.stringify(invoicePartySnapshotSchema.parse(snapshot)); }
export function parsePartySnapshot(json: string): InvoicePartySnapshot { return invoicePartySnapshotSchema.parse(JSON.parse(json)); }
export function fieldValue(fields: PartyField[], key: string): string | null { return fields.find((f) => f.key === key)?.value ?? null; }
