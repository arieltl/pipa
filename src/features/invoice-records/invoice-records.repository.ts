import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { clientInvoiceRecordTypes, type ClientInvoiceRecordType } from "../../db/schema.ts";
import type { InvoiceRecordTypeFormInput } from "./invoice-records.schema.ts";

export function listRecordTypes(clientId: number, includeArchived = false) {
  return db.select().from(clientInvoiceRecordTypes)
    .where(includeArchived ? eq(clientInvoiceRecordTypes.clientId, clientId) : and(eq(clientInvoiceRecordTypes.clientId, clientId), isNull(clientInvoiceRecordTypes.archivedAt)))
    .orderBy(asc(clientInvoiceRecordTypes.position), asc(clientInvoiceRecordTypes.id)).all();
}

export function getRecordType(clientId: number, id: number) {
  return db.select().from(clientInvoiceRecordTypes).where(and(eq(clientInvoiceRecordTypes.clientId, clientId), eq(clientInvoiceRecordTypes.id, id))).get() ?? null;
}

export function getRecordTypeByKey(clientId: number, key: string) {
  return db.select().from(clientInvoiceRecordTypes).where(and(eq(clientInvoiceRecordTypes.clientId, clientId), eq(clientInvoiceRecordTypes.key, key))).get() ?? null;
}

export function insertRecordType(clientId: number, input: InvoiceRecordTypeFormInput): ClientInvoiceRecordType {
  const now = new Date().toISOString();
  const position = listRecordTypes(clientId, true).length;
  return db.insert(clientInvoiceRecordTypes).values({ clientId, key: input.key, name: input.name, purpose: input.purpose, allowMultiple: input.allowMultiple, position, fieldDefinitionsJson: JSON.stringify(input.fieldDefinitionsJson), attachmentDefinitionsJson: JSON.stringify(input.attachmentDefinitionsJson), createdAt: now, updatedAt: now }).returning().get();
}

export function updateRecordTypeRow(id: number, input: InvoiceRecordTypeFormInput) {
  return db.update(clientInvoiceRecordTypes).set({ name: input.name, purpose: input.purpose, allowMultiple: input.allowMultiple, fieldDefinitionsJson: JSON.stringify(input.fieldDefinitionsJson), attachmentDefinitionsJson: JSON.stringify(input.attachmentDefinitionsJson), updatedAt: new Date().toISOString() }).where(eq(clientInvoiceRecordTypes.id, id)).returning().get();
}

export function archiveRecordTypeRow(id: number) {
  db.update(clientInvoiceRecordTypes).set({ archivedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }).where(eq(clientInvoiceRecordTypes.id, id)).run();
}
