import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { join } from "node:path";
import { db } from "../../db/client.ts";
import { files, invoiceFileOwnership, invoiceRecordAttachments, invoiceRecords, invoices, type ClientInvoiceRecordType } from "../../db/schema.ts";
import { parseRecordDefinitions } from "../../domain/invoice-records.ts";
import { isValidDateString } from "../../domain/dates.ts";
import { paths } from "../../config/paths.ts";
import { storeFile } from "../files/files.service.ts";
import type { InvoiceDetail } from "../invoices/invoices.service.ts";
import { getRecordType, listRecordTypes } from "./invoice-records.repository.ts";

export type InvoiceRecordView = ReturnType<typeof listInvoiceRecords>[number];

/** Keep supporting-document uploads bounded even when routes are called directly. */
export const MAX_RECORD_ATTACHMENT_BYTES = 10 * 1024 * 1024;
function recordWrite<T>(invoiceId: number, write: () => T): T { return db.transaction(() => { const result=write(); db.update(invoices).set({workspaceRevision:sql`${invoices.workspaceRevision} + 1`}).where(eq(invoices.id,invoiceId)).run(); return result; }); }

export function listInvoiceRecords(invoiceId: number, includeRemoved = false) {
  const records = db.select().from(invoiceRecords).where(includeRemoved ? eq(invoiceRecords.invoiceId, invoiceId) : and(eq(invoiceRecords.invoiceId, invoiceId), isNull(invoiceRecords.removedAt))).orderBy(asc(invoiceRecords.id)).all();
  return records.map((record) => ({
    ...record,
    definitions: JSON.parse(record.definitionsSnapshotJson) as ReturnType<typeof parseRecordDefinitions>,
    values: JSON.parse(record.valuesJson) as Record<string, string | boolean>,
    attachments: db.select({ attachment: invoiceRecordAttachments, file: files }).from(invoiceRecordAttachments).innerJoin(files, eq(invoiceRecordAttachments.storedFileId, files.id)).where(includeRemoved ? eq(invoiceRecordAttachments.invoiceRecordId, record.id) : and(eq(invoiceRecordAttachments.invoiceRecordId, record.id), isNull(invoiceRecordAttachments.removedAt))).orderBy(asc(invoiceRecordAttachments.id)).all(),
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
  return recordWrite(detail.invoice.id, () => db.insert(invoiceRecords).values({ invoiceId: detail.invoice.id, recordTypeId: type.id, recordTypeKey: type.key, recordTypeName: type.name, purpose: type.purpose, definitionsSnapshotJson: JSON.stringify(definitions), valuesJson: JSON.stringify(clean), createdAt: now, updatedAt: now }).returning().get());
}

export function updateInvoiceRecord(detail: InvoiceDetail, recordId: number, values: Record<string, string | boolean>) {
  const record = ownedRecord(detail.invoice.id, recordId);
  const definitions = JSON.parse(record.definitionsSnapshotJson) as ReturnType<typeof parseRecordDefinitions>;
  const clean = validateValues(definitions.fields, values);
  recordWrite(detail.invoice.id, () => db.update(invoiceRecords).set({ valuesJson: JSON.stringify(clean), updatedAt: new Date().toISOString() }).where(eq(invoiceRecords.id, record.id)).run());
}

export async function attachToInvoiceRecord(detail: InvoiceDetail, recordId: number, definitionKey: string, upload: File) {
  const record = ownedRecord(detail.invoice.id, recordId);
  const definitions = JSON.parse(record.definitionsSnapshotJson) as ReturnType<typeof parseRecordDefinitions>;
  const definition = definitions.attachments.find((item) => item.key === definitionKey);
  if (!definition) throw new Error("Attachment category not found");
  if (upload.size > MAX_RECORD_ATTACHMENT_BYTES) throw new Error("Attachments must be 10 MiB or smaller");
  if (definition.acceptedTypes.length && !definition.acceptedTypes.includes(upload.type)) throw new Error(`Expected ${definition.acceptedTypes.join(", ")}`);
  const bytes = new Uint8Array(await upload.arrayBuffer());

  return recordWrite(detail.invoice.id, () => {
    const tx=db;
    // Re-read while holding SQLite's write transaction. This makes a concurrent
    // upload observe the replacement/count recorded by the first request.
    const current = tx.select({ attachment: invoiceRecordAttachments, file: files }).from(invoiceRecordAttachments).innerJoin(files, eq(invoiceRecordAttachments.storedFileId, files.id)).where(and(eq(invoiceRecordAttachments.invoiceRecordId, record.id), eq(invoiceRecordAttachments.definitionKey, definitionKey))).orderBy(asc(invoiceRecordAttachments.id)).all();
    const active = current.filter(({ file }) => !file.supersededByFileId);
    if (definition.maximumCount > 1 && active.length >= definition.maximumCount) throw new Error(`Maximum ${definition.maximumCount} files`);
    const previous = definition.maximumCount === 1 ? active.at(-1)?.attachment : undefined;

  // Store the immutable bytes first. Only mark the former file superseded once
  // its replacement attachment has been recorded successfully.
    const stored = storeFile({ kind: `invoice_record_${definitionKey}`, bytes, destDir: join(paths.invoiceRecordAttachmentsDir, detail.invoice.invoiceDate.slice(0, 4)), desiredBasename: upload.name || `${record.recordTypeKey}-${definitionKey}`, originalFilename: upload.name, mimeType: upload.type });
    const attachment = tx.insert(invoiceRecordAttachments).values({ invoiceRecordId: record.id, definitionKey, storedFileId: stored.id, supersedesAttachmentId: previous?.id ?? null, createdAt: new Date().toISOString() }).returning().get();
    if (previous) tx.update(files).set({ supersededByFileId: stored.id }).where(eq(files.id, previous.storedFileId)).run();
    return attachment;
  });
}

export function recordFile(detail: InvoiceDetail, fileId: number) {
  const owned = db.select().from(invoiceFileOwnership).where(and(eq(invoiceFileOwnership.invoiceId, detail.invoice.id), eq(invoiceFileOwnership.fileId, fileId))).get();
  if (owned) return db.select().from(files).where(eq(files.id, fileId)).get() ?? null;
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
    if (definition.kind === "url" && value && typeof value === "string") {
      try {
        const url = new URL(value);
        if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error();
      } catch { throw new Error(`${definition.label} must be a valid HTTP(S) URL`); }
    }
    if (definition.kind === "date" && value && typeof value === "string" && !isValidDateString(value)) throw new Error(`${definition.label} must be a valid date`);
    if (definition.kind === "number" && value && typeof value === "string" && !Number.isFinite(Number(value))) throw new Error(`${definition.label} must be a number`);
    if (definition.kind === "select" && value && typeof value === "string" && !definition.choices.includes(value)) throw new Error(`${definition.label} must be one of the configured choices`);
    result[definition.key] = value;
  }
  return result;
}
