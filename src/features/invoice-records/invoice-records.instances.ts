import { and, asc, eq } from "drizzle-orm";
import { join } from "node:path";
import { db } from "../../db/client.ts";
import { files, invoiceRecordAttachments, invoiceRecords, type ClientInvoiceRecordType } from "../../db/schema.ts";
import { parseRecordDefinitions } from "../../domain/invoice-records.ts";
import { paths } from "../../config/paths.ts";
import { supersedeFile } from "../files/files.service.ts";
import type { InvoiceDetail } from "../invoices/invoices.service.ts";
import { getRecordType, listRecordTypes } from "./invoice-records.repository.ts";

export type InvoiceRecordView = ReturnType<typeof listInvoiceRecords>[number];

export function listInvoiceRecords(invoiceId: number) {
  const records = db.select().from(invoiceRecords).where(eq(invoiceRecords.invoiceId, invoiceId)).orderBy(asc(invoiceRecords.id)).all();
  return records.map((record) => ({
    ...record,
    definitions: JSON.parse(record.definitionsSnapshotJson) as ReturnType<typeof parseRecordDefinitions>,
    values: JSON.parse(record.valuesJson) as Record<string, string | boolean>,
    attachments: db.select({ attachment: invoiceRecordAttachments, file: files }).from(invoiceRecordAttachments).innerJoin(files, eq(invoiceRecordAttachments.storedFileId, files.id)).where(eq(invoiceRecordAttachments.invoiceRecordId, record.id)).orderBy(asc(invoiceRecordAttachments.id)).all(),
  }));
}

export function applicableRecordTypes(clientId: number) { return listRecordTypes(clientId); }

export function createInvoiceRecord(detail: InvoiceDetail, recordTypeId: number, values: Record<string, string | boolean>) {
  const type = getRecordType(detail.client.id, recordTypeId);
  if (!type || type.archivedAt) throw new Error("Record type not found");
  const existing = listInvoiceRecords(detail.invoice.id).filter((record) => record.recordTypeId === type.id);
  if (!type.allowMultiple && existing.length) throw new Error("This invoice already has this record type");
  const definitions = parseRecordDefinitions(type.fieldDefinitionsJson, type.attachmentDefinitionsJson);
  const clean = validateValues(definitions.fields, values, false);
  const now = new Date().toISOString();
  return db.insert(invoiceRecords).values({ invoiceId: detail.invoice.id, recordTypeId: type.id, recordTypeKey: type.key, recordTypeName: type.name, purpose: type.purpose, definitionsSnapshotJson: JSON.stringify(definitions), valuesJson: JSON.stringify(clean), createdAt: now, updatedAt: now }).returning().get();
}

export function updateInvoiceRecord(detail: InvoiceDetail, recordId: number, values: Record<string, string | boolean>) {
  const record = ownedRecord(detail.invoice.id, recordId);
  const definitions = JSON.parse(record.definitionsSnapshotJson) as ReturnType<typeof parseRecordDefinitions>;
  const clean = validateValues(definitions.fields, values);
  db.update(invoiceRecords).set({ valuesJson: JSON.stringify(clean), updatedAt: new Date().toISOString() }).where(eq(invoiceRecords.id, record.id)).run();
}

export async function attachToInvoiceRecord(detail: InvoiceDetail, recordId: number, definitionKey: string, upload: File) {
  const record = ownedRecord(detail.invoice.id, recordId);
  const definitions = JSON.parse(record.definitionsSnapshotJson) as ReturnType<typeof parseRecordDefinitions>;
  const definition = definitions.attachments.find((item) => item.key === definitionKey);
  if (!definition) throw new Error("Attachment category not found");
  if (definition.acceptedTypes.length && !definition.acceptedTypes.includes(upload.type)) throw new Error(`Expected ${definition.acceptedTypes.join(", ")}`);
  const current = db.select().from(invoiceRecordAttachments).where(and(eq(invoiceRecordAttachments.invoiceRecordId, record.id), eq(invoiceRecordAttachments.definitionKey, definitionKey))).orderBy(asc(invoiceRecordAttachments.id)).all();
  if (definition.maximumCount > 1 && current.length >= definition.maximumCount) throw new Error(`Maximum ${definition.maximumCount} files`);
  const previous = definition.maximumCount === 1 ? current.at(-1) : undefined;
  const stored = supersedeFile(previous?.storedFileId, { kind: `invoice_record_${definitionKey}`, bytes: new Uint8Array(await upload.arrayBuffer()), destDir: join(paths.invoiceRecordAttachmentsDir, detail.invoice.invoiceDate.slice(0, 4)), desiredBasename: upload.name || `${record.recordTypeKey}-${definitionKey}`, originalFilename: upload.name, mimeType: upload.type });
  return db.insert(invoiceRecordAttachments).values({ invoiceRecordId: record.id, definitionKey, storedFileId: stored.id, supersedesAttachmentId: previous?.id ?? null, createdAt: new Date().toISOString() }).returning().get();
}

export function recordFile(detail: InvoiceDetail, fileId: number) {
  const recordIds = new Set(listInvoiceRecords(detail.invoice.id).map((record) => record.id));
  return db.select({ attachment: invoiceRecordAttachments, file: files }).from(invoiceRecordAttachments).innerJoin(files, eq(invoiceRecordAttachments.storedFileId, files.id)).where(eq(invoiceRecordAttachments.storedFileId, fileId)).all().find((row) => recordIds.has(row.attachment.invoiceRecordId))?.file ?? null;
}

function ownedRecord(invoiceId: number, recordId: number) { const record = db.select().from(invoiceRecords).where(and(eq(invoiceRecords.invoiceId, invoiceId), eq(invoiceRecords.id, recordId))).get(); if (!record) throw new Error("Invoice record not found"); return record; }

function validateValues(definitions: ReturnType<typeof parseRecordDefinitions>["fields"], values: Record<string, string | boolean>, enforceRequired = true) {
  const result: Record<string, string | boolean> = {};
  for (const definition of definitions) {
    const raw = values[definition.key];
    const value = definition.kind === "boolean" ? raw === true || raw === "true" || raw === "on" : String(raw ?? "").trim();
    if (enforceRequired && definition.required && (value === "" || value === false)) throw new Error(`${definition.label} is required`);
    if (definition.kind === "url" && value && typeof value === "string") { try { new URL(value); } catch { throw new Error(`${definition.label} must be a valid URL`); } }
    if (definition.kind === "date" && value && typeof value === "string" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${definition.label} must be a valid date`);
    result[definition.key] = value;
  }
  return result;
}
