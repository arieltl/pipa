import type { ClientInvoiceRecordType } from "../../db/schema.ts";
import type { InvoiceRecordTypeFormInput } from "./invoice-records.schema.ts";
import * as repo from "./invoice-records.repository.ts";

export class RecordTypeNotFoundError extends Error {}
export class RecordTypeKeyTakenError extends Error {}
export class RecordTypeKeyImmutableError extends Error {}
export class RecordTypePurposeTakenError extends Error {}

export const listClientRecordTypes = repo.listRecordTypes;

export function createRecordType(clientId: number, input: InvoiceRecordTypeFormInput) {
  assertUnique(clientId, input);
  return repo.insertRecordType(clientId, input);
}

export function updateRecordType(clientId: number, id: number, input: InvoiceRecordTypeFormInput) {
  const existing = repo.getRecordType(clientId, id);
  if (!existing) throw new RecordTypeNotFoundError();
  if (existing.key !== input.key) throw new RecordTypeKeyImmutableError("The key cannot change after creation");
  assertUnique(clientId, input, existing);
  return repo.updateRecordTypeRow(id, input);
}

export function archiveRecordType(clientId: number, id: number) {
  if (!repo.getRecordType(clientId, id)) throw new RecordTypeNotFoundError();
  repo.archiveRecordTypeRow(id);
}

function assertUnique(clientId: number, input: InvoiceRecordTypeFormInput, current?: ClientInvoiceRecordType) {
  const sameKey = repo.getRecordTypeByKey(clientId, input.key);
  if (sameKey && sameKey.id !== current?.id) throw new RecordTypeKeyTakenError("That key is already used by this client");
  if (input.purpose === "nfse") {
    const used = repo.listRecordTypes(clientId).find((item) => item.purpose === "nfse" && item.id !== current?.id);
    if (used) throw new RecordTypePurposeTakenError("This client already has an active NFS-e record type");
  }
}
