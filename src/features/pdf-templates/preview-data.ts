import { z } from "zod";
import type { Client, IssuerSettings } from "../../db/schema.ts";
import { formatDateBr, isValidDateString } from "../../domain/dates.ts";
import { formatMoney, minorToDecimalString, SUPPORTED_CURRENCIES } from "../../domain/money.ts";
import { parseRecordDefinitions } from "../../domain/invoice-records.ts";
import { PARTY_FIELD_SECTIONS, parsePartyFields, type PartyFieldSection } from "../../domain/party-fields/index.ts";
import type { DocumentField, DocumentParty, InvoiceDocumentModel } from "../../pdf/document-model.ts";
import { sampleInvoiceDocument } from "../../pdf/sample-document.ts";
import { getClientById, listClients } from "../clients/clients.repository.ts";
import { listRecordTypes } from "../invoice-records/invoice-records.repository.ts";
import { getIssuerSettings } from "../settings/settings.repository.ts";

const sourceSchema = z.enum(["sample", "empty"]);
const safeKey = z.string().min(1).max(64).regex(/^[a-z][a-z0-9_]*$/)
  .refine((key) => !["__proto__", "prototype", "constructor"].includes(key), "That field key is reserved");

export const previewDataSchema = z.object({
  version: z.literal(1).default(1),
  issuerSource: z.enum(["settings", "sample", "empty"]).optional(),
  customerSource: z.enum(["sample", "empty", "client"]).optional(),
  customerClientId: z.number().int().positive().optional(),
  invoiceSource: sourceSchema.optional(),
  customFieldDefinitions: z.array(z.object({
    party: z.enum(["issuer", "customer"]), key: safeKey,
    label: z.string().trim().min(1).max(120), section: z.enum(PARTY_FIELD_SECTIONS),
  })).max(100).optional(),
  overrides: z.record(z.string().min(1).max(160), z.union([z.string().max(4000), z.boolean()])).optional(),
}).superRefine((value, ctx) => {
  if (value.customerSource === "client" && !value.customerClientId)
    ctx.addIssue({ code: "custom", path: ["customerClientId"], message: "Choose a client for the customer source" });
  const seen = new Set<string>();
  for (const [index, field] of (value.customFieldDefinitions ?? []).entries()) {
    const id = `${field.party}:${field.key}`;
    if (seen.has(id)) ctx.addIssue({ code: "custom", path: ["customFieldDefinitions", index, "key"], message: "Duplicate custom field key" });
    seen.add(id);
  }
  const overrides = value.overrides ?? {};
  if (Object.keys(overrides).length > 300) ctx.addIssue({ code: "custom", path: ["overrides"], message: "Too many preview overrides" });
  for (const key of Object.keys(overrides)) if (!/^(issuer|customer|invoice|items|records)\./.test(key) || /(?:^|\.)(__proto__|prototype|constructor)(?:\.|$)/.test(key)) ctx.addIssue({ code: "custom", path: ["overrides", key], message: "Invalid preview override path" });
});
export type PreviewDataConfig = z.infer<typeof previewDataSchema>;

export type PreviewField = { path: string; label: string; group: "issuer" | "customer" | "invoice" | "items" | "records"; kind: "text" | "boolean" | "money"; value: string | boolean; emptyValue: string | boolean; editable: true };
export type PreviewDataResponse = { config: Required<Pick<PreviewDataConfig, "version" | "issuerSource" | "customerSource" | "invoiceSource">> & { customerClientId?: number }; clientOptions: Array<{ id: number; name: string; code: string }>; document: InvoiceDocumentModel; fields: PreviewField[]; warnings: Array<{ path: string; message: string }> };

export class PreviewDataError extends Error {}

function sections(): DocumentParty["sections"] {
  return { identity: [], contact: [], address: [], payment: [], other: [] };
}
function emptyParty(customer = false): DocumentParty {
  return { name: "", ...(customer ? { code: "" } : {}), fields: [], field: {}, sections: sections() };
}
function fieldParty(row: { name: string; code?: string; partyFieldsJson: string }, customer = false): DocumentParty {
  const fields = parsePartyFields(row.partyFieldsJson).filter((field) => field.visibility === "document").sort((a, b) => PARTY_FIELD_SECTIONS.indexOf(a.section) - PARTY_FIELD_SECTIONS.indexOf(b.section) || a.position - b.position || a.key.localeCompare(b.key)).map(({ key, label, value, section }) => ({ key, label, value, section }));
  const documentFields: DocumentField[] = fields.map(({ key, label, value }) => ({ key, label, value }));
  const field = Object.fromEntries(documentFields.map((item) => [item.key, item]));
  const grouped = sections();
  for (const item of fields) grouped[item.section].push(field[item.key]!);
  return { name: row.name, ...(customer ? { code: row.code ?? "" } : {}), fields: documentFields, field, sections: grouped };
}
function copySample(): InvoiceDocumentModel { return structuredClone(sampleInvoiceDocument); }
function addPreviewDefinitions(party: DocumentParty, definitions: Array<{ key: string; label: string; section: PartyFieldSection }>) {
  for (const definition of definitions) {
    if (party.field[definition.key]) continue;
    const field = { key: definition.key, label: definition.label, value: "" };
    party.fields.push(field); party.field[definition.key] = field; party.sections[definition.section].push(field);
  }
}

function defaults(input: Partial<PreviewDataConfig>, issuer: IssuerSettings | null): PreviewDataConfig {
  return { version: 1, issuerSource: input.issuerSource ?? (issuer ? "settings" : "sample"), customerSource: input.customerSource ?? "sample", ...(input.customerClientId ? { customerClientId: input.customerClientId } : {}), invoiceSource: input.invoiceSource ?? "sample", customFieldDefinitions: input.customFieldDefinitions ?? [], overrides: input.overrides ?? {} };
}

function allowedPaths(document: InvoiceDocumentModel): Map<string, PreviewField> {
  const result = new Map<string, PreviewField>();
  const add = (path: string, label: string, group: PreviewField["group"], kind: PreviewField["kind"], value: string | boolean) => result.set(path, { path, label, group, kind, value, emptyValue: kind === "boolean" ? false : kind === "money" ? "0" : "", editable: true });
  for (const party of ["issuer", "customer"] as const) {
    const value = document[party]; add(`${party}.name`, "Name", party, "text", value.name);
    if (party === "customer") add("customer.code", "Client code", "customer", "text", value.code ?? "");
    for (const item of value.fields) add(`${party}.field.${item.key}.value`, item.label, party, "text", item.value);
  }
  add("invoice.number", "Invoice number", "invoice", "text", document.invoice.number);
  add("invoice.dateIso", "Invoice date", "invoice", "text", document.invoice.dateIso);
  add("invoice.currency", "Currency", "invoice", "text", document.invoice.currency);
  add("invoice.notes", "Notes", "invoice", "text", document.invoice.notes ?? "");
  document.items.forEach((item, index) => { add(`items.${index}.name`, `Item ${index + 1} name`, "items", "text", item.name); add(`items.${index}.valueMinor`, `Item ${index + 1} amount`, "items", "money", String(item.valueMinor)); });
  document.records.forEach((record, index) => Object.entries(record.field).forEach(([key, value]) => add(`records.${index}.field.${key}.value`, value.label, "records", typeof value.value === "boolean" ? "boolean" : "text", value.value)));
  return result;
}

function setValue(document: InvoiceDocumentModel, path: string, value: string | boolean | number) {
  const parts = path.split("."); let target: any = document;
  for (const part of parts.slice(0, -1)) target = target[Number.isInteger(Number(part)) ? Number(part) : part];
  target[parts.at(-1)!] = value;
}
function recalculate(document: InvoiceDocumentModel) {
  const currency = document.invoice.currency || "USD";
  const total = document.items.reduce((sum, item) => {
    if (!Number.isSafeInteger(item.valueMinor) || item.valueMinor < 0 || !Number.isSafeInteger(sum + item.valueMinor)) throw new PreviewDataError("Preview item amounts must add up to a safe integer total");
    return sum + item.valueMinor;
  }, 0);
  document.items.forEach((item) => item.valueDisplay = formatMoney(item.valueMinor, currency));
  document.total = { minor: total, decimal: minorToDecimalString(total, currency), display: formatMoney(total, currency) };
  document.invoice.dateDisplay = document.invoice.dateIso ? formatDateBr(document.invoice.dateIso) : "";
  const [year = "", month = ""] = document.invoice.dateIso ? document.invoice.dateIso.split("-") : [];
  document.invoice.dateYear = year; document.invoice.dateMonth = month;
}

/** Match renderer snapshots: empty document fields are absent from field/maps/sections. */
function normalizeParty(party: DocumentParty): void {
  const visible = party.fields.filter((field) => field.value.trim() !== "");
  const grouped = sections();
  for (const section of PARTY_FIELD_SECTIONS) grouped[section] = visible.filter((field) => party.sections[section].some((candidate) => candidate.key === field.key));
  party.sections = grouped;
  party.fields = PARTY_FIELD_SECTIONS.flatMap((section) => grouped[section]);
  party.field = Object.fromEntries(party.fields.map((field) => [field.key, field]));
}

/** Resolves only the selected client. The returned model is preview-only. */
export function resolvePreviewData(raw: Partial<PreviewDataConfig> = {}, includeOptions = true): PreviewDataResponse {
  const issuer = getIssuerSettings(); const config = defaults(previewDataSchema.parse(raw), issuer);
  const document = copySample();
  if (config.issuerSource === "settings") document.issuer = issuer ? fieldParty(issuer) : emptyParty();
  if (config.issuerSource === "empty") document.issuer = emptyParty();
  if (config.customerSource === "empty") document.customer = emptyParty(true);
  if (config.customerSource === "client") {
    const client = getClientById(config.customerClientId!);
    if (!client) throw new PreviewDataError("The selected preview client no longer exists. Choose another client.");
    document.customer = fieldParty(client, true);
    document.records = listRecordTypes(client.id).map((record) => ({ typeKey: record.key, typeName: record.name, purpose: record.purpose, field: Object.fromEntries(parseRecordDefinitions(record.fieldDefinitionsJson, record.attachmentDefinitionsJson).fields.map((field) => [field.key, { label: field.label, value: field.kind === "boolean" ? false : "" }])) }));
  }
  if (config.invoiceSource === "empty") {
    document.invoice = { number: "", dateIso: "", dateDisplay: "", dateYear: "", dateMonth: "", currency: "", notes: "" };
    document.items = []; document.records = []; document.notaFiscal = null;
  }
  addPreviewDefinitions(document.issuer, config.customFieldDefinitions!.filter((item) => item.party === "issuer"));
  addPreviewDefinitions(document.customer, config.customFieldDefinitions!.filter((item) => item.party === "customer"));
  const catalog = allowedPaths(document);
  for (const [path, value] of Object.entries(config.overrides!)) {
    const descriptor = catalog.get(path);
    if (!descriptor) throw new PreviewDataError(`Preview override is not allowed: ${path}`);
    if (descriptor.kind === "boolean" ? typeof value !== "boolean" : typeof value !== "string") throw new PreviewDataError(`Preview override has an invalid value: ${path}`);
    if (descriptor.kind === "money" && (value !== "" && (!/^\d+$/.test(value as string) || !Number.isSafeInteger(Number(value))))) throw new PreviewDataError(`Preview amount must be a whole minor-unit value: ${path}`);
    const nextValue: string | boolean = descriptor.kind === "money" ? String(value === "" ? 0 : Number(value)) : value;
    setValue(document, path, descriptor.kind === "money" ? Number(nextValue) : value);
  }
  if (document.invoice.dateIso !== "" && !isValidDateString(document.invoice.dateIso)) throw new PreviewDataError("Preview invoice date must be empty or a valid YYYY-MM-DD date");
  if (document.invoice.currency !== "" && !SUPPORTED_CURRENCIES.includes(document.invoice.currency as typeof SUPPORTED_CURRENCIES[number])) throw new PreviewDataError("Preview currency must be empty or a supported currency");
  recalculate(document);
  if (config.invoiceSource === "empty") document.total = { minor: 0, decimal: "", display: "" };
  normalizeParty(document.issuer); normalizeParty(document.customer);
  return { config: { version: 1, issuerSource: config.issuerSource!, customerSource: config.customerSource!, ...(config.customerSource === "client" ? { customerClientId: config.customerClientId } : {}), invoiceSource: config.invoiceSource! }, clientOptions: includeOptions ? listClients().map((client) => ({ id: client.id, name: client.name, code: client.code })) : [], document, fields: [...catalog.values()], warnings: [] };
}

export function parsePreviewData(value: string | undefined): PreviewDataConfig | undefined {
  if (!value) return undefined;
  if (value.length > 100 * 1024) throw new PreviewDataError("Preview data is too large");
  try { return previewDataSchema.parse(JSON.parse(value)); }
  catch (error) { throw new PreviewDataError(error instanceof Error ? `Invalid preview data: ${error.message}` : "Invalid preview data"); }
}
