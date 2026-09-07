import { z } from "zod";

export const PARTY_FIELD_SECTIONS = [
  "identity", "contact", "address", "payment", "other",
] as const;
export type PartyFieldSection = (typeof PARTY_FIELD_SECTIONS)[number];

export const partyFieldSchema = z.object({
  key: z.string().min(1).max(64).regex(/^[a-z][a-z0-9_]*$/),
  definitionKey: z.string().max(64).nullable(),
  label: z.string().trim().min(1).max(120),
  value: z.string().max(4000),
  section: z.enum(PARTY_FIELD_SECTIONS),
  visibility: z.enum(["document", "internal"]),
  position: z.number().int().nonnegative(),
});

export type PartyField = z.infer<typeof partyFieldSchema>;

export const partyFieldsSchema = z.array(partyFieldSchema).max(100).superRefine((fields, ctx) => {
  const seen = new Set<string>();
  fields.forEach((field, index) => {
    const key = field.key.toLowerCase();
    if (seen.has(key)) ctx.addIssue({ code: "custom", path: [index, "key"], message: `Duplicate field key: ${field.key}` });
    seen.add(key);
  });
});

export type PartyFieldDefinition = {
  key: string;
  defaultLabel: string;
  section: PartyFieldSection;
  inputKind: "text" | "multiline" | "email" | "phone" | "url" | "country" | "tax-id" | "bank-account";
  validation?: { mode: "none" | "warning" | "strict"; format?: string };
  aliases?: string[];
};

const definitions: PartyFieldDefinition[] = [
  ["legal_name", "Legal name", "identity", "text"], ["tax_id", "Tax ID", "identity", "text"],
  ["br_cnpj", "CNPJ", "identity", "tax-id", "warning"], ["br_cpf", "CPF", "identity", "tax-id", "warning"],
  ["vat_number", "VAT number", "identity", "text"], ["company_registration", "Company registration", "identity", "text"],
  ["email", "Email", "contact", "email", "strict"], ["phone", "Phone", "contact", "phone"],
  ["website", "Website", "contact", "url", "strict"], ["address", "Address", "address", "multiline"],
  ["country", "Country", "address", "country"], ["payment_beneficiary", "Beneficiary", "payment", "text"],
  ["beneficiary_address", "Beneficiary address", "payment", "multiline"], ["bank_name", "Bank name", "payment", "text"],
  ["bank_address", "Bank address", "payment", "multiline"], ["account_number", "Account number", "payment", "bank-account"],
  ["iban", "IBAN", "payment", "bank-account", "warning"], ["swift_bic", "SWIFT / BIC", "payment", "bank-account", "warning"],
  ["routing_number", "Routing number", "payment", "bank-account", "warning"], ["sort_code", "Sort code", "payment", "bank-account", "warning"],
  ["pix", "PIX", "payment", "text", "warning"], ["payment_instructions", "Payment instructions", "payment", "multiline"],
].map(([key, defaultLabel, section, inputKind, mode]) => ({
  key, defaultLabel, section, inputKind, ...(mode ? { validation: { mode } } : {}),
})) as PartyFieldDefinition[];

export const PARTY_FIELD_DEFINITIONS = Object.fromEntries(definitions.map((d) => [d.key, d])) as Record<string, PartyFieldDefinition>;

export const PARTY_FIELD_SETS = {
  generic_business: ["legal_name", "tax_id", "email", "phone", "address", "country"],
  minimal_customer: ["legal_name", "email", "address", "country"],
  brazilian_business: ["legal_name", "br_cnpj", "email", "phone", "address", "country"],
  international_bank_transfer: ["payment_beneficiary", "beneficiary_address", "bank_name", "bank_address", "account_number", "iban", "swift_bic", "payment_instructions"],
  brazilian_payment_pix: ["payment_beneficiary", "br_cnpj", "pix", "payment_instructions"],
  uk_bank_transfer: ["payment_beneficiary", "account_number", "sort_code"],
  us_ach_wire: ["payment_beneficiary", "account_number", "routing_number", "bank_name"],
} as const;

export function parsePartyFields(json: string): PartyField[] { return partyFieldsSchema.parse(JSON.parse(json)); }
export function serializePartyFields(fields: PartyField[]): string { return JSON.stringify(partyFieldsSchema.parse(fields)); }

export function applyFieldSet(fields: PartyField[], set: keyof typeof PARTY_FIELD_SETS): PartyField[] {
  const result = partyFieldsSchema.parse(fields).map((f) => ({ ...f }));
  const existing = new Set(result.map((f) => f.key.toLowerCase()));
  for (const key of PARTY_FIELD_SETS[set]) {
    if (existing.has(key)) continue;
    const d = PARTY_FIELD_DEFINITIONS[key]!;
    result.push({ key, definitionKey: key, label: d.defaultLabel, value: "", section: d.section, visibility: "document", position: result.filter((f) => f.section === d.section).length });
    existing.add(key);
  }
  return result;
}

export function documentFields(fields: PartyField[]): PartyField[] {
  return partyFieldsSchema.parse(fields).filter((f) => f.visibility === "document" && f.value.trim() !== "").sort((a, b) => PARTY_FIELD_SECTIONS.indexOf(a.section) - PARTY_FIELD_SECTIONS.indexOf(b.section) || a.position - b.position || a.key.localeCompare(b.key));
}

export type PartyFieldWarning = { key: string; message: string };
export function validatePartyFieldValues(fields: PartyField[]): PartyFieldWarning[] {
  const warnings: PartyFieldWarning[] = [];
  for (const field of fields) {
    const value = field.value.trim(); if (!value) continue;
    const d = field.definitionKey ? PARTY_FIELD_DEFINITIONS[field.definitionKey] : undefined;
    if (d?.inputKind === "email" && !z.email().safeParse(value).success) throw new Error(`${field.label}: enter a valid email address`);
    if (d?.inputKind === "url" && !z.url().safeParse(value).success) throw new Error(`${field.label}: enter a valid URL`);
    if (field.definitionKey === "br_cnpj" && !/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/.test(value)) warnings.push({ key: field.key, message: `${field.label} does not match 00.000.000/0000-00` });
    if (field.definitionKey === "iban" && !/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/i.test(value.replace(/\s/g, ""))) warnings.push({ key: field.key, message: `${field.label} may not be a valid IBAN` });
    if (field.definitionKey === "swift_bic" && !/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/i.test(value)) warnings.push({ key: field.key, message: `${field.label} may not be a valid SWIFT / BIC` });
  }
  return warnings;
}

export function mergePartyFieldValues(currentJson: string | undefined, values: Record<string, string | null | undefined>): string {
  const fields = currentJson ? parsePartyFields(currentJson) : [];
  for (const [key, raw] of Object.entries(values)) {
    const d = PARTY_FIELD_DEFINITIONS[key]; if (!d) continue;
    const value = raw ?? "";
    const existing = fields.find((f) => f.key.toLowerCase() === key);
    if (existing) existing.value = value;
    else fields.push({ key, definitionKey: key, label: d.defaultLabel, value, section: d.section, visibility: "document", position: fields.filter((f) => f.section === d.section).length });
  }
  return serializePartyFields(fields);
}
