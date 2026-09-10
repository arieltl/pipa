import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, extname, join, relative } from "node:path";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../../db/client.ts";
import {
  files, invoiceDeletionReceipts, invoiceEditGenerations, invoiceEditSessions, invoiceFileOwnership,
  clientInvoiceRecordTypes,
  invoiceGeneratedTexts, invoiceItems, invoiceOperations, invoiceRebases,
  invoicePdfVersions, invoicePreviews, invoiceRecordAttachments, invoiceRecords, invoiceStagedFiles, invoices,
  notaFiscalLinks, pdfTemplateRevisions,
} from "../../db/schema.ts";
import { paths } from "../../config/paths.ts";
import { sanitizeFilename } from "../../domain/filename-template.ts";
import { isValidDateString, nowIso } from "../../domain/dates.ts";
import { parseMoneyToMinor } from "../../domain/money.ts";
import { createPartySnapshot, serializePartySnapshot } from "../../domain/party-fields/snapshot.ts";
import { parseRecordDefinitions } from "../../domain/invoice-records.ts";
import { listInvoiceRecords } from "../invoice-records/invoice-records.instances.ts";
import { operationIdentity, sha256Identity, WorkspaceConflictError, WorkspaceValidationError, type WorkspaceFieldError } from "../../domain/invoice-workspace.ts";
import { canManuallyTransition } from "../../domain/invoice-status.ts";
import { getInvoiceDetail, pdfRenderingDependencySignature, renderInvoicePdf } from "./invoices.service.ts";
import { generateText } from "../text-generators/text-generators.service.ts";
import type { RebaseInput, WorkspaceChanges, WorkspaceCommandInput, WorkspaceSaveEnvelope } from "./invoice-workspace.schema.ts";
import { projectWorkspace, type ResolvedWorkspaceSelections, type WorkspaceProjectionBase } from "./workspace-projection.ts";
import { compareWorkspace, type WorkspaceComparison } from "./workspace-conflict.ts";
export { maintainWorkspaceState } from "./invoice-workspace.maintenance.ts";
import { maintainWorkspaceState } from "./invoice-workspace.maintenance.ts";

const SESSION_MS = 24 * 60 * 60 * 1000;
const CLAIM_MS = 30_000;

export type Snapshot = ReturnType<typeof workspaceSnapshot>;
type PreparedAttachment = { token: string; recordKey: string; definitionKey: string; storedPath: string; originalFilename: string; mimeType: string | null; sizeBytes: number; digest: string; legacyKind?: "pdf" | "xml" };
export type OperationResult = {
  outcome: "committed" | "rejected" | "processing";
  operationId: string;
  kind: string;
  digest: string;
  code?: string;
  message: string;
  resultingRevision?: number;
  resultingGeneration?: number;
  tempKeyMap?: Record<string, number>;
  normalized?: unknown;
  fieldErrors?: WorkspaceFieldError[];
  currentRevision?: number;
  currentStatus?: string;
  conflict?: { previouslyLoaded: Snapshot; currentSaved: Snapshot; comparison?: WorkspaceComparison[] };
};

function expiresAt(ms = SESSION_MS) { return new Date(Date.now() + ms).toISOString(); }
function parseResult(json: string | null): OperationResult | null { return json ? JSON.parse(json) as OperationResult : null; }

export function workspaceSnapshot(invoiceId: number) {
  const detail = getInvoiceDetail(invoiceId);
  if (!detail) throw new WorkspaceConflictError("NOT_FOUND", "Invoice not found.");
  const partyRefresh = detail.issuer ? {
    issuerSnapshotJson: serializePartySnapshot(createPartySnapshot(detail.issuer)),
    clientSnapshotJson: serializePartySnapshot(createPartySnapshot(detail.client)),
  } : null;
  return {
    invoice: {
      id: detail.invoice.id, number: detail.invoice.number, invoiceDate: detail.invoice.invoiceDate,
      currency: detail.invoice.currency, status: detail.invoice.status, notes: detail.invoice.notes,
      pdfTemplateRevisionId: detail.invoice.pdfTemplateRevisionId,
      issuerSnapshotJson: detail.invoice.issuerSnapshotJson, clientSnapshotJson: detail.invoice.clientSnapshotJson,
      workspaceRevision: detail.invoice.workspaceRevision,
    },
    items: detail.items.map(({ id, name, value, source, notes, position }) => ({ id, name, value, source, notes, position })),
    generatedTexts: detail.generatedTexts.map(({ id, generatorKey, generatorName, sourceSnapshot, content }) => ({ id, generatorKey, generatorName, sourceSnapshot, content })),
    records: listInvoiceRecords(invoiceId, true).map((record) => ({
      id: record.id, recordTypeId: record.recordTypeId, recordTypeKey: record.recordTypeKey,
      recordTypeName: record.recordTypeName, purpose: record.purpose,
      definitionsSnapshotJson: record.definitionsSnapshotJson, values: record.values,
      removedAt: record.removedAt,
      attachments: record.attachments.map(({ attachment, file }) => ({ id: attachment.id, definitionKey: attachment.definitionKey, fileId: file.id, originalFilename: file.originalFilename, supersededByFileId: file.supersededByFileId, removedAt: attachment.removedAt })),
    })),
    legacy: detail.notaFiscal ? {
      id: detail.notaFiscal.id, nfNumber: detail.notaFiscal.nfNumber, issueDate: detail.notaFiscal.issueDate,
      verificationCode: detail.notaFiscal.verificationCode, publicUrl: detail.notaFiscal.publicUrl,
      notes: detail.notaFiscal.notes, pdfFileId: detail.notaFiscal.pdfFileId, xmlFileId: detail.notaFiscal.xmlFileId,
    } : null,
    partyRefresh: partyRefresh ? { ...partyRefresh, digest: sha256Identity(partyRefresh) } : null,
    availableRecordTypes: detail.recordTypes.filter((type) => !type.archivedAt).map((type) => {
      const snapshot = { id: type.id, clientId: type.clientId, key: type.key, name: type.name, purpose: type.purpose, allowMultiple: type.allowMultiple, definitionsSnapshotJson: JSON.stringify({ fields: JSON.parse(type.fieldDefinitionsJson), attachments: JSON.parse(type.attachmentDefinitionsJson) }) };
      return { ...snapshot, digest: sha256Identity(snapshot) };
    }),
  };
}

export function createEditSession(invoiceId: number, editSessionId: string, desiredBaseRevision: number) {
  maintainWorkspaceState();
  const existing = db.select().from(invoiceEditSessions).where(eq(invoiceEditSessions.id, editSessionId)).get();
  if (existing) {
    if (existing.invoiceId !== invoiceId) throw new WorkspaceConflictError("SESSION_SCOPE", "This edit session belongs to another invoice.");
    const base = db.select().from(invoiceEditGenerations).where(and(eq(invoiceEditGenerations.sessionId, editSessionId), eq(invoiceEditGenerations.generation, 1))).get();
    return { session: existing, base: base ? JSON.parse(base.snapshotJson) as Snapshot : null };
  }
  const snapshot = workspaceSnapshot(invoiceId);
  if (snapshot.invoice.workspaceRevision !== desiredBaseRevision) throw new WorkspaceConflictError("STALE_REVISION", "This invoice changed before editing began.", snapshot.invoice.workspaceRevision, snapshot.invoice.status);
  const now = nowIso();
  return db.transaction((tx) => {
    const session = tx.insert(invoiceEditSessions).values({ id: editSessionId, invoiceId, currentGeneration: 1, state: "active", expiresAt: expiresAt(), createdAt: now, updatedAt: now }).returning().get();
    tx.insert(invoiceEditGenerations).values({ sessionId: editSessionId, generation: 1, invoiceRevision: desiredBaseRevision, snapshotJson: JSON.stringify(snapshot), createdAt: now }).run();
    return { session, base: snapshot };
  });
}

function getOperation(invoiceId: number, operationId: string) {
  return db.select().from(invoiceOperations).where(and(eq(invoiceOperations.invoiceId, invoiceId), eq(invoiceOperations.id, operationId))).get() ?? null;
}

export function operationResult(invoiceId: number, operationId: string): OperationResult | null {
  const deleted=db.select().from(invoiceDeletionReceipts).where(and(eq(invoiceDeletionReceipts.invoiceId,invoiceId),eq(invoiceDeletionReceipts.operationId,operationId))).get();
  if(deleted)return {outcome:deleted.outcome as "committed"|"rejected",operationId,kind:deleted.kind,digest:deleted.digest,code:deleted.code??undefined,message:deleted.message};
  const operation = getOperation(invoiceId, operationId);
  if (!operation) return null;
  const result = parseResult(operation.resultJson);
  if (!result) return { outcome: "processing", operationId, kind: operation.kind, digest: operation.digest, message: "The operation is still processing." };
  const enriched=enrichCommittedBase(operation, result);
  if (enriched.outcome === "rejected" && operation.sessionId) { const detail=db.select().from(invoiceRebases).where(and(eq(invoiceRebases.sessionId,operation.sessionId),eq(invoiceRebases.id,`operation:${operationId}`))).get(); if(detail){try{return {...enriched,conflict:JSON.parse(detail.resultJson).conflict};}catch{}} }
  return enriched;
}

export function deleteDraftInvoiceCommand(invoiceId:number,input:WorkspaceCommandInput):OperationResult {
  const priorIdentity=db.select().from(invoiceDeletionReceipts).where(and(eq(invoiceDeletionReceipts.invoiceId,invoiceId),eq(invoiceDeletionReceipts.operationId,input.operationId))).get();if(priorIdentity&&(priorIdentity.kind!==input.kind||priorIdentity.digest!==input.canonicalPayloadDigest))throw new WorkspaceConflictError("OPERATION_KEY_REUSED","This operation key was already used with different content."); const digest=commandDigest(input);if(input.kind!=="delete"||digest!==input.canonicalPayloadDigest)throw new WorkspaceConflictError("DIGEST_MISMATCH","The deletion identity did not match.");
  return db.transaction((tx)=>{const prior=tx.select().from(invoiceDeletionReceipts).where(and(eq(invoiceDeletionReceipts.invoiceId,invoiceId),eq(invoiceDeletionReceipts.operationId,input.operationId))).get();if(prior){if(prior.kind!==input.kind||prior.digest!==digest)throw new WorkspaceConflictError("OPERATION_KEY_REUSED","This operation key was already used with different content.");return{outcome:prior.outcome as "committed"|"rejected",operationId:input.operationId,kind:prior.kind,digest:prior.digest,code:prior.code??undefined,message:prior.message};}const existing=tx.select().from(invoiceOperations).where(and(eq(invoiceOperations.invoiceId,invoiceId),eq(invoiceOperations.id,input.operationId))).get();if(existing)throw new WorkspaceConflictError("OPERATION_KEY_REUSED","This operation key was already used by another command.");const invoice=tx.select().from(invoices).where(eq(invoices.id,invoiceId)).get();let result:OperationResult;if(!invoice||invoice.workspaceRevision!==input.expectedRevision)result={outcome:"rejected",operationId:input.operationId,kind:"delete",digest,code:"STALE_REVISION",message:"This invoice changed before deletion."};else if(invoice.status!=="draft")result={outcome:"rejected",operationId:input.operationId,kind:"delete",digest,code:"INVALID_STATUS",message:"Only a draft invoice can be deleted."};else{tx.delete(invoices).where(and(eq(invoices.id,invoiceId),eq(invoices.workspaceRevision,input.expectedRevision),eq(invoices.status,"draft"))).run();result={outcome:"committed",operationId:input.operationId,kind:"delete",digest,message:"Draft invoice deleted."};}tx.insert(invoiceDeletionReceipts).values({invoiceId,operationId:input.operationId,kind:"delete",digest,outcome:result.outcome,code:result.code??null,message:result.message,createdAt:nowIso()}).run();return result;});
}

/** Canonical bases are lease-limited session data, never invoice-lifetime receipt plaintext. */
function enrichCommittedBase(operation: { sessionId: string | null }, result: OperationResult): OperationResult {
  if (result.outcome !== "committed" || !operation.sessionId || !result.resultingGeneration) return result;
  const generation = db.select().from(invoiceEditGenerations).where(and(eq(invoiceEditGenerations.sessionId, operation.sessionId), eq(invoiceEditGenerations.generation, result.resultingGeneration))).get();
  return generation ? { ...result, normalized: { canonicalBase: JSON.parse(generation.snapshotJson) } } : result;
}

function claimOperation(invoiceId: number, operationId: string, sessionId: string | null, kind: string, digest: string): { generation: number; replay?: OperationResult } {
  return db.transaction((tx) => {
    const deleted = tx.select().from(invoiceDeletionReceipts).where(and(eq(invoiceDeletionReceipts.invoiceId, invoiceId), eq(invoiceDeletionReceipts.operationId, operationId))).get();
    if (deleted) throw new WorkspaceConflictError("OPERATION_KEY_REUSED", "This operation key was already used by a deletion command.");
    const found = tx.select().from(invoiceOperations).where(and(eq(invoiceOperations.invoiceId, invoiceId), eq(invoiceOperations.id, operationId))).get();
    if (found) {
      if (found.kind !== kind || found.digest !== digest || found.sessionId !== sessionId) throw new WorkspaceConflictError("OPERATION_KEY_REUSED", "This operation key was already used with different content.");
      const result = parseResult(found.resultJson);
      if (result) return { generation: found.fencingGeneration, replay: operationResult(invoiceId, operationId) ?? result };
      if (found.leaseExpiresAt && found.leaseExpiresAt > nowIso()) return { generation: found.fencingGeneration, replay: { outcome: "processing", operationId, kind, digest, message: "The operation is still processing." } };
      const generation = found.fencingGeneration + 1;
      tx.update(invoiceOperations).set({ fencingGeneration: generation, leaseExpiresAt: expiresAt(CLAIM_MS), updatedAt: nowIso() }).where(and(eq(invoiceOperations.invoiceId, invoiceId), eq(invoiceOperations.id, operationId))).run();
      return { generation };
    }
    const now = nowIso();
    tx.insert(invoiceOperations).values({ id: operationId, invoiceId, sessionId, kind, digest, state: "processing", fencingGeneration: 1, leaseExpiresAt: expiresAt(CLAIM_MS), resultJson: null, createdAt: now, updatedAt: now }).run();
    return { generation: 1 };
  });
}

function reject(invoiceId: number, operationId: string, generation: number, digest: string, code: string, message: string, fieldErrors?: WorkspaceFieldError[], conflict?: { previouslyLoaded: Snapshot; currentSaved: Snapshot; comparison?: WorkspaceComparison[] }): OperationResult {
  const result: OperationResult = { outcome: "rejected", operationId, kind: "save", digest, code, message, ...(fieldErrors ? { fieldErrors } : {}), ...(conflict ? { currentRevision: conflict.currentSaved.invoice.workspaceRevision, currentStatus: conflict.currentSaved.invoice.status, conflict } : {}) };
  // Conflict snapshots are lease-limited session data. A durable rejected
  // receipt keeps only identity and current revision/status, never proposal or
  // document plaintext.
  const receipt = { ...result }; delete receipt.conflict;
  const stored = db.transaction((tx) => { const operation=tx.select().from(invoiceOperations).where(and(eq(invoiceOperations.invoiceId,invoiceId),eq(invoiceOperations.id,operationId),eq(invoiceOperations.fencingGeneration,generation),eq(invoiceOperations.state,"processing"))).get(); if(!operation)return false; if(conflict&&operation.sessionId)tx.insert(invoiceRebases).values({id:`operation:${operationId}`,sessionId:operation.sessionId,digest,state:"operation-detail",fromGeneration:1,toGeneration:null,resultJson:JSON.stringify({conflict}),createdAt:nowIso()}).onConflictDoNothing().run(); return Boolean(tx.update(invoiceOperations).set({state:"rejected",resultJson:JSON.stringify(receipt),leaseExpiresAt:null,updatedAt:nowIso()}).where(and(eq(invoiceOperations.invoiceId,invoiceId),eq(invoiceOperations.id,operationId),eq(invoiceOperations.fencingGeneration,generation),eq(invoiceOperations.state,"processing"))).returning({id:invoiceOperations.id}).get()); });
  return stored ? result : operationResult(invoiceId, operationId) ?? { outcome: "processing", operationId, kind: "save", digest, message: "Another worker is resolving this operation." };
}

function duplicates(values: Array<string | number>) { return new Set(values).size !== values.length; }

function validateChanges(snapshot: Snapshot, changes: WorkspaceChanges, trustedBase: Snapshot = snapshot): WorkspaceFieldError[] {
  const errors: WorkspaceFieldError[] = [];
  const error = (path: string, label: string, message: string, section: WorkspaceFieldError["section"]) => errors.push({ path, label, message, section });
  const locked = snapshot.invoice.status !== "draft";
  if (locked && (changes.document || changes.items)) error("document", "Document", "The invoice document is locked. Keep these values as a recovery proposal or revert separately.", "document");
  if (changes.document?.number !== undefined && !changes.document.number.trim()) error("document.number", "Invoice number", "Enter an invoice number.", "document");
  if (changes.document?.invoiceDate !== undefined && !isValidDateString(changes.document.invoiceDate)) error("document.invoiceDate", "Invoice date", "Enter a valid date.", "document");
  if (changes.document?.partyRefreshDigest !== undefined && changes.document.partyRefreshDigest !== trustedBase.partyRefresh?.digest) error("document.partyRefreshDigest", "Party details", "The selected party details are no longer available in this editing base.", "document");
  const itemIds = new Set(snapshot.items.map((item) => item.id));
  const itemChanges = changes.items;
  if (itemChanges) {
    if (duplicates(itemChanges.updates.map((x) => x.id)) || duplicates(itemChanges.removals)) error("items", "Line items", "An item may be changed only once.", "document");
    if (duplicates(itemChanges.additions.map((x) => x.key)) || duplicates(itemChanges.order)) error("items.order", "Item order", "Item keys and order must be unique.", "document");
    itemChanges.updates.forEach((change, index) => {
      if (!itemIds.has(change.id)) error(`items.updates.${index}`, "Line item", "This item no longer belongs to the invoice.", "document");
      validateItem(change.value, snapshot.invoice.currency, `items.id:${change.id}`, error);
    });
    itemChanges.additions.forEach((change) => validateItem(change.value, snapshot.invoice.currency, `items.${change.key}`, error));
    itemChanges.removals.forEach((id) => { if (!itemIds.has(id)) error(`items.removals.${id}`, "Line item", "This item no longer belongs to the invoice.", "document"); });
    const expectedOrder = new Set<string>([...snapshot.items.filter((item) => !itemChanges.removals.includes(item.id)).map((item) => `id:${item.id}`), ...itemChanges.additions.map((item) => item.key)]);
    if (itemChanges.order.length !== expectedOrder.size || itemChanges.order.some((key) => !expectedOrder.has(key))) error("items.order", "Item order", "Order must include every remaining item exactly once and no foreign rows.", "document");
  }
  if (changes.generatedTexts) {
    if (duplicates(changes.generatedTexts.map((text) => text.generatorKey))) error("generatedTexts", "Generated text", "Each saved text may be changed only once.", "text");
    for (const text of changes.generatedTexts) {
      const saved = snapshot.generatedTexts.find((candidate) => candidate.generatorKey === text.generatorKey);
      const active = getInvoiceDetail(snapshot.invoice.id)?.textGenerators.find((candidate) => candidate.key === text.generatorKey);
      if (!saved && !active) { error(`generatedTexts.${text.generatorKey}`, text.generatorName, "This text source does not belong to the invoice.", "text"); continue; }
      const expectedName = saved?.generatorName ?? active!.name; const expectedSource = saved?.sourceSnapshot ?? active!.source;
      if (text.generatorName !== expectedName || text.sourceSnapshot !== expectedSource) error(`generatedTexts.${text.generatorKey}`, expectedName, "The generator identity or source snapshot does not match the retained invoice source.", "text");
    }
  }
  const recordIds = new Set(snapshot.records.map((record) => record.id));
  if (changes.records) {
    if (duplicates(changes.records.updates.map((x) => x.id)) || duplicates(changes.records.removals) || duplicates(changes.records.additions.map((x) => x.key))) error("records", "Supporting records", "A record may be changed only once.", "records");
    for (const change of changes.records.updates) {
      const record = snapshot.records.find((r) => r.id === change.id);
      if (!record || record.removedAt) { error(`records.id:${change.id}`, "Supporting record", "This record is no longer active.", "records"); continue; }
      validateRecordFields(record.definitionsSnapshotJson, { ...record.values, ...change.setFields }, new Set(change.clearFields), `records.id:${change.id}`, error, change.setFields);
    }
    changes.records.removals.forEach((id) => { if (!recordIds.has(id)) error(`records.removals.${id}`, "Supporting record", "This record does not belong to the invoice.", "records"); });
    for (const addition of changes.records.additions) {
      const selected = trustedBase.availableRecordTypes.find((type) => type.id === addition.recordTypeId && type.digest === addition.recordTypeSnapshotDigest);
      if (!selected) { error(`records.${addition.key}`, "Supporting record", "The selected record definition does not match this editing base.", "records"); continue; }
      validateRecordFields(selected.definitionsSnapshotJson, addition.setFields, new Set(), `records.${addition.key}`, error, addition.setFields);
    }
  }
  if (changes.attachments) {
    const attachmentIds = new Set(snapshot.records.flatMap((r) => r.attachments.map((a) => a.id)));
    if (duplicates(changes.attachments.removals) || duplicates(changes.attachments.additions.map((x) => x.token))) error("attachments", "Attachments", "An attachment may be changed only once.", "records");
    changes.attachments.removals.forEach((id) => { if (!attachmentIds.has(id)) error(`attachments.removals.${id}`, "Attachment", "This attachment does not belong to the invoice.", "records"); });
    const validRecordKeys = new Set([...(snapshot.records.filter((r) => !r.removedAt).map((r) => `id:${r.id}`)), ...(changes.records?.additions.map((r) => r.key) ?? [])]);
    changes.attachments.additions.forEach((entry, index) => { if (!validRecordKeys.has(entry.recordKey)) error(`attachments.additions.${index}`, "Attachment", "Choose an active supporting record.", "records"); });
  }
  if (changes.legacy) {
    const allowed = new Set(["number", "issueDate", "verificationCode", "publicUrl", "notes"]);
    for (const key of [...Object.keys(changes.legacy.setFields), ...changes.legacy.clearFields]) if (!allowed.has(key)) error(`legacy.${key}`, "Legacy tax field", "This legacy field is not supported.", "records");
    const url = changes.legacy.setFields.publicUrl;
    for (const [key, value] of Object.entries(changes.legacy.setFields)) if (typeof value !== "string") error(`legacy.${key}`, "Legacy tax field", "Enter text in this field.", "records");
    const issueDate = changes.legacy.setFields.issueDate;
    if (typeof issueDate === "string" && issueDate && !isValidDateString(issueDate)) error("legacy.issueDate", "Issue date", "Enter a valid date.", "records");
    if (typeof url === "string" && url) { try { const parsed = new URL(url); if (!["http:", "https:"].includes(parsed.protocol)) throw new Error(); } catch { error("legacy.publicUrl", "Public URL", "Enter a valid HTTP(S) URL.", "records"); } }
  }
  if (changes.legacyAttachments && (duplicates(changes.legacyAttachments.additions.map(item=>item.kind)) || duplicates(changes.legacyAttachments.removals) || changes.legacyAttachments.additions.some(item=>changes.legacyAttachments!.removals.includes(item.kind)))) error("legacyAttachments", "Legacy attachments", "Choose each legacy PDF or XML attachment only once.", "records");
  return errors;
}

function validateItem(item: { name: string; value: string }, currency: string, path: string, error: (p: string,l:string,m:string,s:"document")=>void) {
  if (!item.name.trim()) error(`${path}.name`, "Item description", "Enter an item description.", "document");
  if (parseMoneyToMinor(item.value, currency) === null) error(`${path}.value`, "Amount", "Enter a valid amount.", "document");
}

function validateRecordFields(definitionsJson: string, values: Record<string, string | boolean>, clears: Set<string>, path: string, error: (p:string,l:string,m:string,s:"records")=>void, mutations: Record<string,string|boolean> = values) {
  const definitions = JSON.parse(definitionsJson) as ReturnType<typeof parseRecordDefinitions>;
  const byKey = new Map(definitions.fields.map((definition) => [definition.key, definition]));
  for (const key of [...Object.keys(mutations), ...clears]) if (!byKey.has(key)) error(`${path}.${key}`, "Supporting record field", "This field is not in the retained record definition.", "records");
  for (const definition of definitions.fields) {
    const value = clears.has(definition.key) ? undefined : values[definition.key];
    if (definition.required && (value === undefined || value === "" || value === false)) error(`${path}.${definition.key}`, definition.label, `${definition.label} is required.`, "records");
    if (definition.kind === "url" && typeof value === "string" && value) { try { const u = new URL(value); if (!["http:", "https:"].includes(u.protocol)) throw new Error(); } catch { error(`${path}.${definition.key}`, definition.label, "Enter a valid HTTP(S) URL.", "records"); } }
    if (definition.kind === "date" && typeof value === "string" && value && !isValidDateString(value)) error(`${path}.${definition.key}`, definition.label, "Enter a valid date.", "records");
    if (definition.kind === "number" && typeof value === "string" && value && !Number.isFinite(Number(value))) error(`${path}.${definition.key}`, definition.label, "Enter a valid number.", "records");
    if (definition.kind === "boolean" && value !== undefined && typeof value !== "boolean") error(`${path}.${definition.key}`, definition.label, "Choose true or false.", "records");
    if (definition.kind !== "boolean" && value !== undefined && typeof value !== "string") error(`${path}.${definition.key}`, definition.label, "Enter text in this field.", "records");
    if (definition.kind === "select" && typeof value === "string" && value && !definition.choices.includes(value)) error(`${path}.${definition.key}`, definition.label, "Choose one of the configured options.", "records");
  }
}

export function saveWorkspace(invoiceId: number, envelope: WorkspaceSaveEnvelope): OperationResult {
  const digest = operationIdentity(envelope);
  if (digest !== envelope.canonicalPayloadDigest) throw new WorkspaceConflictError("DIGEST_MISMATCH", "The save payload identity did not match.");
  const claimed = claimOperation(invoiceId, envelope.operationId, envelope.editSessionId, envelope.kind, digest);
  if (claimed.replay) return claimed.replay;
  const generation = claimed.generation;
  try {
    const session = db.select().from(invoiceEditSessions).where(and(eq(invoiceEditSessions.id, envelope.editSessionId), eq(invoiceEditSessions.invoiceId, invoiceId))).get();
    if (!session || session.state !== "active" || session.expiresAt <= nowIso()) return reject(invoiceId, envelope.operationId, generation, digest, "SESSION_EXPIRED", "This editing session expired. Your local values were not saved.");
    if (session.currentGeneration !== envelope.baseGeneration) return reject(invoiceId, envelope.operationId, generation, digest, "STALE_GENERATION", "This editing base has already changed.");
    const baseRow = db.select().from(invoiceEditGenerations).where(and(eq(invoiceEditGenerations.sessionId, session.id), eq(invoiceEditGenerations.generation, envelope.baseGeneration))).get();
    if (!baseRow) return reject(invoiceId, envelope.operationId, generation, digest, "SESSION_EXPIRED", "The trusted editing base is no longer available.");
    const base = JSON.parse(baseRow.snapshotJson) as Snapshot;
    if (baseRow.invoiceRevision !== envelope.baseRevision) return reject(invoiceId, envelope.operationId, generation, digest, "BASE_MISMATCH", "The editing revision does not match its trusted base.");
    const latest = workspaceSnapshot(invoiceId);
    if (latest.invoice.workspaceRevision !== envelope.baseRevision) return reject(invoiceId, envelope.operationId, generation, digest, "STALE_REVISION", "This invoice changed since it was opened. Your changes have not been applied.", undefined, { previouslyLoaded: base, currentSaved: latest, comparison: compareWorkspace(base, latest, envelope.changes) });
    const errors = validateChanges(latest, envelope.changes, base);
    if (errors.length) return reject(invoiceId, envelope.operationId, generation, digest, errors.some((x) => x.path === "document") && latest.invoice.status !== "draft" ? "DOCUMENT_LOCKED" : "VALIDATION", `No changes saved. Review ${errors.length} field${errors.length === 1 ? "" : "s"}.`, errors);
    const prepared = prepareAttachments(invoiceId, envelope.editSessionId, envelope.changes, latest);
    return commitSave(invoiceId, envelope, generation, digest, base, prepared);
  } catch (cause) {
    if (cause instanceof WorkspaceValidationError) return reject(invoiceId, envelope.operationId, generation, digest, "VALIDATION", cause.message, cause.errors);
    if (cause instanceof WorkspaceConflictError) return reject(invoiceId, envelope.operationId, generation, digest, cause.code, cause.message);
    // A SQLite transaction error after a claimed operation means its child
    // writes rolled back. Record that proven rollback as the terminal receipt;
    // if this follow-up write itself fails, let the caller treat it as unknown.
    return reject(invoiceId, envelope.operationId, generation, digest, "COMMIT_ROLLED_BACK", "No changes were saved because the transaction rolled back.");
  }
}

function prepareAttachments(invoiceId: number, sessionId: string, changes: WorkspaceChanges, snapshot: Snapshot): PreparedAttachment[] {
  const prepared: PreparedAttachment[] = [];
  const requested = [...(changes.attachments?.additions ?? []), ...(changes.legacyAttachments?.additions ?? []).map(item => ({ recordKey: "legacy:nfse", definitionKey: item.kind, token: item.token, legacyKind: item.kind }))];
  for (const request of requested) {
    const staged = db.select().from(invoiceStagedFiles).where(and(eq(invoiceStagedFiles.token, request.token), eq(invoiceStagedFiles.invoiceId, invoiceId), eq(invoiceStagedFiles.sessionId, sessionId), eq(invoiceStagedFiles.recordKey, request.recordKey), eq(invoiceStagedFiles.definitionKey, request.definitionKey))).get();
    if (!staged || staged.state !== "staged" || staged.expiresAt <= nowIso()) throw new WorkspaceValidationError([{ path: `attachments.${request.recordKey}.${request.definitionKey}`, label: staged?.originalFilename ?? "Attachment", message: "This staged file expired or does not belong to this editing session. Select it again.", section: "records" }]);
    if (request.recordKey === "legacy:nfse") { const staged=db.select().from(invoiceStagedFiles).where(and(eq(invoiceStagedFiles.token,request.token),eq(invoiceStagedFiles.invoiceId,invoiceId),eq(invoiceStagedFiles.sessionId,sessionId),eq(invoiceStagedFiles.recordKey,"legacy:nfse"),eq(invoiceStagedFiles.definitionKey,request.definitionKey))).get(); if(!staged||staged.state!=="staged"||staged.expiresAt<=nowIso())throw new WorkspaceValidationError([{path:`legacyAttachments.${request.definitionKey}`,label:"Legacy attachment",message:"This staged legacy file expired or does not belong to this session.",section:"records"}]); const ext=sanitizeFilename(extname(staged.originalFilename));const stem=sanitizeFilename(basename(staged.originalFilename,extname(staged.originalFilename)))||"legacy";const destDir=join(paths.invoiceRecordAttachmentsDir,snapshot.invoice.invoiceDate.slice(0,4));mkdirSync(destDir,{recursive:true});const absolute=join(destDir,`${stem}-${staged.token}${ext}`);copyFileSync(staged.storedPath,absolute);prepared.push({token:staged.token,recordKey:request.recordKey,definitionKey:request.definitionKey,storedPath:relative(paths.filesDir,absolute),originalFilename:staged.originalFilename,mimeType:staged.mimeType,sizeBytes:staged.sizeBytes,digest:staged.digest,legacyKind:request.definitionKey as "pdf"|"xml"});continue; }
    const record = request.recordKey.startsWith("id:") ? snapshot.records.find((r) => r.id === Number(request.recordKey.slice(3))) : null;
    const addition = changes.records?.additions.find((r) => r.key === request.recordKey);
    let definitionsJson = record?.definitionsSnapshotJson;
    if (!definitionsJson && addition) {
      const currentInvoice = db.select().from(invoices).where(eq(invoices.id, invoiceId)).get()!;
      const recordType = db.get(sql`select field_definitions_json, attachment_definitions_json from client_invoice_record_types where id = ${addition.recordTypeId} and client_id = ${currentInvoice.clientId} and archived_at is null`) as { field_definitions_json: string; attachment_definitions_json: string } | null;
      if (recordType) definitionsJson = JSON.stringify({ fields: JSON.parse(recordType.field_definitions_json), attachments: JSON.parse(recordType.attachment_definitions_json) });
    }
    if (!definitionsJson) throw new WorkspaceValidationError([{ path: `attachments.${request.recordKey}`, label: "Attachment", message: "The supporting record is unavailable.", section: "records" }]);
    const definitions = JSON.parse(definitionsJson) as ReturnType<typeof parseRecordDefinitions>;
    const definition = definitions.attachments.find((x) => x.key === request.definitionKey);
    if (!definition) throw new WorkspaceValidationError([{ path: `attachments.${request.recordKey}.${request.definitionKey}`, label: "Attachment", message: "This attachment category is unavailable.", section: "records" }]);
    if (definition.acceptedTypes.length && (!staged.mimeType || !definition.acceptedTypes.includes(staged.mimeType))) throw new WorkspaceValidationError([{ path: `attachments.${request.recordKey}.${request.definitionKey}`, label: definition.label, message: `Expected ${definition.acceptedTypes.join(", ")}.`, section: "records" }]);
    const year = snapshot.invoice.invoiceDate.slice(0, 4); const destDir = join(paths.invoiceRecordAttachmentsDir, year); mkdirSync(destDir, { recursive: true });
    const ext = sanitizeFilename(extname(staged.originalFilename)); const stem = sanitizeFilename(basename(staged.originalFilename, extname(staged.originalFilename))) || "attachment";
    const filename = `${stem}-${staged.token}${ext ? `.${ext.replace(/^\./, "")}` : ""}`; const absolute = join(destDir, filename); copyFileSync(staged.storedPath, absolute);
    prepared.push({ token: staged.token, recordKey: request.recordKey, definitionKey: request.definitionKey, storedPath: relative(paths.filesDir, absolute), originalFilename: staged.originalFilename, mimeType: staged.mimeType, sizeBytes: staged.sizeBytes, digest: staged.digest });
  }
  return prepared;
}

function commitSave(invoiceId: number, envelope: WorkspaceSaveEnvelope, claimGeneration: number, digest: string, base: Snapshot, prepared: PreparedAttachment[]): OperationResult {
  return db.transaction((tx) => {
    const op = tx.select().from(invoiceOperations).where(and(eq(invoiceOperations.invoiceId, invoiceId), eq(invoiceOperations.id, envelope.operationId))).get();
    const replay = parseResult(op?.resultJson ?? null); if (replay) return replay;
    if (!op || op.state !== "processing" || op.fencingGeneration !== claimGeneration) throw new WorkspaceConflictError("CLAIM_LOST", "Another worker owns this save.");
    const current = tx.select().from(invoices).where(eq(invoices.id, invoiceId)).get();
    if (!current || current.workspaceRevision !== envelope.baseRevision) throw new WorkspaceConflictError("STALE_REVISION", "This invoice changed before the save could commit.", current?.workspaceRevision, current?.status);
    const now = nowIso(); const nextRevision = current.workspaceRevision + 1; const tempKeyMap: Record<string, number> = {};
    const changes = envelope.changes;
    const selections: ResolvedWorkspaceSelections = {
      ...(changes.document?.partyRefreshDigest && base.partyRefresh ? { partyRefresh: base.partyRefresh } : {}),
      recordTypes: Object.fromEntries((changes.records?.additions ?? []).flatMap((addition) => {
        const selected = base.availableRecordTypes.find((type) => type.id === addition.recordTypeId && type.digest === addition.recordTypeSnapshotDigest);
        return selected ? [[addition.key, { recordTypeId: selected.id, recordTypeKey: selected.key, recordTypeName: selected.name, purpose: selected.purpose, definitionsSnapshotJson: selected.definitionsSnapshotJson }]] : [];
      })),
    };
    const projection = projectWorkspace(base as WorkspaceProjectionBase, changes, selections);
    if (changes.document) {
      const update: Record<string, unknown> = { updatedAt: now };
      if (changes.document.number !== undefined) update.number = projection.invoice.number;
      if (changes.document.invoiceDate !== undefined) update.invoiceDate = projection.invoice.invoiceDate;
      if (changes.document.pdfTemplateRevisionId !== undefined) {
        const revision = tx.select().from(pdfTemplateRevisions).where(eq(pdfTemplateRevisions.id, changes.document.pdfTemplateRevisionId)).get();
        if (!revision) throw new WorkspaceValidationError([{ path: "document.pdfTemplateRevisionId", label: "PDF template", message: "Choose an available template revision.", section: "document" }]);
        update.pdfTemplateRevisionId = revision.id;
      }
      if (changes.document.partyRefreshDigest) {
        if (!base.partyRefresh || changes.document.partyRefreshDigest !== base.partyRefresh.digest) throw new WorkspaceValidationError([{ path: "document.partyRefreshDigest", label: "Party details", message: "The selected party snapshot is unavailable.", section: "document" }]);
        update.issuerSnapshotJson = projection.invoice.issuerSnapshotJson;
        update.clientSnapshotJson = projection.invoice.clientSnapshotJson;
      }
      tx.update(invoices).set(update).where(eq(invoices.id, invoiceId)).run();
    }
    if (changes.items) {
      for (const change of changes.items.updates) { const item = projection.items.find((row) => row.rowKey === `id:${change.id}`)!; tx.update(invoiceItems).set({ name: item.name, value: item.value, source: item.source, notes: item.notes, updatedAt: now }).where(and(eq(invoiceItems.id, change.id), eq(invoiceItems.invoiceId, invoiceId))).run(); }
      for (const id of changes.items.removals) tx.delete(invoiceItems).where(and(eq(invoiceItems.id, id), eq(invoiceItems.invoiceId, invoiceId))).run();
      for (const change of changes.items.additions) { const item = projection.items.find((row) => row.rowKey === change.key)!; const row = tx.insert(invoiceItems).values({ invoiceId, name: item.name, value: item.value, source: item.source, notes: item.notes, position: item.position, createdAt: now, updatedAt: now }).returning().get(); tempKeyMap[change.key] = row.id; }
      changes.items.order.forEach((key, position) => { const id = key.startsWith("id:") ? Number(key.slice(3)) : tempKeyMap[key]; if (id) tx.update(invoiceItems).set({ position, updatedAt: now }).where(and(eq(invoiceItems.id, id), eq(invoiceItems.invoiceId, invoiceId))).run(); });
    }
    if (changes.setNotes !== undefined) tx.update(invoices).set({ notes: projection.invoice.notes, updatedAt: now }).where(eq(invoices.id, invoiceId)).run();
    for (const text of projection.generatedTexts.filter((text) => (changes.generatedTexts ?? []).some((change) => change.generatorKey === text.generatorKey))) tx.insert(invoiceGeneratedTexts).values({ invoiceId, generatorId: null, generatorKey: text.generatorKey, generatorName: text.generatorName, sourceSnapshot: text.sourceSnapshot, content: text.content, createdAt: now, updatedAt: now }).onConflictDoUpdate({ target: [invoiceGeneratedTexts.invoiceId, invoiceGeneratedTexts.generatorKey], set: { generatorName: text.generatorName, sourceSnapshot: text.sourceSnapshot, content: text.content, updatedAt: now } }).run();
    if (changes.records) {
      for (const change of changes.records.updates) { const row = tx.select().from(invoiceRecords).where(and(eq(invoiceRecords.id, change.id), eq(invoiceRecords.invoiceId, invoiceId), isNull(invoiceRecords.removedAt))).get()!; const values = JSON.parse(row.valuesJson) as Record<string,string|boolean>; Object.assign(values, change.setFields); change.clearFields.forEach((key) => delete values[key]); tx.update(invoiceRecords).set({ valuesJson: JSON.stringify(values), updatedAt: now }).where(eq(invoiceRecords.id, row.id)).run(); }
      for (const id of changes.records.removals) tx.update(invoiceRecords).set({ removedAt: now, updatedAt: now }).where(and(eq(invoiceRecords.id, id), eq(invoiceRecords.invoiceId, invoiceId))).run();
      for (const change of changes.records.additions) {
        // New selections are independently resolved from the client's current definitions.
        const selected = base.availableRecordTypes.find((type) => type.id === change.recordTypeId && type.digest === change.recordTypeSnapshotDigest);
        const live = tx.select().from(clientInvoiceRecordTypes).where(and(eq(clientInvoiceRecordTypes.id, change.recordTypeId), eq(clientInvoiceRecordTypes.clientId, current.clientId), isNull(clientInvoiceRecordTypes.archivedAt))).get();
        if (!live) throw new WorkspaceValidationError([{ path: `records.${change.key}`, label: "Supporting record", message: "This record type is no longer available.", section: "records" }]);
        if (!selected) throw new WorkspaceValidationError([{ path: `records.${change.key}`, label: live.name, message: "The selected record snapshot does not match this editing base.", section: "records" }]);
        const definitionsSnapshotJson = selected.definitionsSnapshotJson;
        validateRecordFields(definitionsSnapshotJson, change.setFields, new Set(), `records.${change.key}`, (p,l,m,s) => { throw new WorkspaceValidationError([{ path:p,label:l,message:m,section:s }]); });
        const sameType = tx.select().from(invoiceRecords).where(and(eq(invoiceRecords.invoiceId, invoiceId), eq(invoiceRecords.recordTypeId, change.recordTypeId), isNull(invoiceRecords.removedAt))).all();
        if (!live.allowMultiple && sameType.length) throw new WorkspaceValidationError([{ path: `records.${change.key}`, label: live.name, message: "This invoice already has this record type.", section: "records" }]);
        const row = tx.insert(invoiceRecords).values({ invoiceId, recordTypeId: change.recordTypeId, recordTypeKey: selected.key, recordTypeName: selected.name, purpose: selected.purpose, definitionsSnapshotJson, valuesJson: JSON.stringify(change.setFields), removedAt: null, createdAt: now, updatedAt: now }).returning().get(); tempKeyMap[change.key] = row.id;
      }
    }
    for (const attachmentId of changes.attachments?.removals ?? []) tx.update(invoiceRecordAttachments).set({ removedAt: now }).where(and(eq(invoiceRecordAttachments.id, attachmentId), isNull(invoiceRecordAttachments.removedAt), sql`${invoiceRecordAttachments.invoiceRecordId} in (select id from invoice_records where invoice_id = ${invoiceId})`)).run();
    for (const item of prepared) {
      if (item.legacyKind) {
        let legacy=tx.select().from(notaFiscalLinks).where(eq(notaFiscalLinks.invoiceId,invoiceId)).get();
        if(!legacy) legacy=tx.insert(notaFiscalLinks).values({invoiceId,nfNumber:null,issueDate:null,verificationCode:null,publicUrl:null,notes:null,pdfFileId:null,xmlFileId:null,createdAt:now,updatedAt:now}).returning().get();
        const pointer=item.legacyKind === "pdf" ? "pdfFileId" : "xmlFileId"; const previous=legacy[pointer]; const stored=tx.insert(files).values({kind:`legacy_nfse_${item.legacyKind}`,originalFilename:item.originalFilename,storedPath:item.storedPath,mimeType:item.mimeType,sizeBytes:item.sizeBytes,sha256:item.digest,deletedAt:null,supersededByFileId:null,createdAt:now}).returning().get();
        if(previous)tx.update(files).set({supersededByFileId:stored.id}).where(eq(files.id,previous)).run(); tx.update(notaFiscalLinks).set({[pointer]:stored.id,updatedAt:now}).where(eq(notaFiscalLinks.id,legacy.id)).run(); tx.insert(invoiceFileOwnership).values({invoiceId,fileId:stored.id,purpose:"legacy_nfse",provenanceJson:JSON.stringify({kind:item.legacyKind}),createdAt:now}).run();tx.update(invoiceStagedFiles).set({state:"committed",fencingGeneration:claimGeneration}).where(and(eq(invoiceStagedFiles.token,item.token),eq(invoiceStagedFiles.state,"staged"))).run();continue;
      }
      const recordId = item.recordKey.startsWith("id:") ? Number(item.recordKey.slice(3)) : tempKeyMap[item.recordKey];
      if (!recordId) throw new WorkspaceValidationError([{ path: `attachments.${item.recordKey}`, label: item.originalFilename, message: "The supporting record could not be resolved.", section: "records" }]);
      const record = tx.select().from(invoiceRecords).where(and(eq(invoiceRecords.id, recordId), eq(invoiceRecords.invoiceId, invoiceId), isNull(invoiceRecords.removedAt))).get();
      if (!record) throw new WorkspaceValidationError([{ path: `attachments.${item.recordKey}`, label: item.originalFilename, message: "The supporting record is no longer active.", section: "records" }]);
      const definitions = JSON.parse(record.definitionsSnapshotJson) as ReturnType<typeof parseRecordDefinitions>; const definition = definitions.attachments.find((x) => x.key === item.definitionKey);
      if (!definition) throw new WorkspaceValidationError([{ path: `attachments.${item.recordKey}.${item.definitionKey}`, label: item.originalFilename, message: "The attachment category is no longer available.", section: "records" }]);
      const active = tx.select({ attachment: invoiceRecordAttachments, file: files }).from(invoiceRecordAttachments).innerJoin(files, eq(invoiceRecordAttachments.storedFileId, files.id)).where(and(eq(invoiceRecordAttachments.invoiceRecordId, recordId), eq(invoiceRecordAttachments.definitionKey, item.definitionKey), isNull(invoiceRecordAttachments.removedAt), isNull(files.supersededByFileId))).orderBy(asc(invoiceRecordAttachments.id)).all();
      if (definition.maximumCount > 1 && active.length >= definition.maximumCount) throw new WorkspaceValidationError([{ path: `attachments.${item.recordKey}.${item.definitionKey}`, label: definition.label, message: `Maximum ${definition.maximumCount} files.`, section: "records" }]);
      const stored = tx.insert(files).values({ kind: `invoice_record_${item.definitionKey}`, originalFilename: item.originalFilename, storedPath: item.storedPath, mimeType: item.mimeType, sizeBytes: item.sizeBytes, sha256: item.digest, deletedAt: null, supersededByFileId: null, createdAt: now }).returning().get();
      const previous = definition.maximumCount === 1 ? active.at(-1) : undefined;
      const attachment = tx.insert(invoiceRecordAttachments).values({ invoiceRecordId: recordId, definitionKey: item.definitionKey, storedFileId: stored.id, supersedesAttachmentId: previous?.attachment.id ?? null, removedAt: null, createdAt: now }).returning().get();
      if (previous) tx.update(files).set({ supersededByFileId: stored.id }).where(eq(files.id, previous.file.id)).run();
      tx.insert(invoiceFileOwnership).values({ invoiceId, fileId: stored.id, purpose: "supporting_record", provenanceJson: JSON.stringify({ recordId, attachmentId: attachment.id, definitionKey: item.definitionKey }), createdAt: now }).run();
      tx.update(invoiceStagedFiles).set({ state: "committed", fencingGeneration: claimGeneration }).where(and(eq(invoiceStagedFiles.token, item.token), eq(invoiceStagedFiles.state, "staged"))).run();
    }
    if (changes.legacy) {
      const legacy = tx.select().from(notaFiscalLinks).where(eq(notaFiscalLinks.invoiceId, invoiceId)).get();
      const fieldMap: Record<string,string> = { number: "nfNumber", issueDate: "issueDate", verificationCode: "verificationCode", publicUrl: "publicUrl", notes: "notes" };
      const update: Record<string,unknown> = { updatedAt: now };
      for (const [key,value] of Object.entries(changes.legacy.setFields)) if (fieldMap[key]) update[fieldMap[key]] = value;
      for (const key of changes.legacy.clearFields) if (fieldMap[key]) update[fieldMap[key]] = null;
      if (legacy) tx.update(notaFiscalLinks).set(update).where(eq(notaFiscalLinks.id, legacy.id)).run();
      else tx.insert(notaFiscalLinks).values({ invoiceId, nfNumber: null, issueDate: null, verificationCode: null, publicUrl: null, notes: null, ...update, createdAt: now, updatedAt: now }).run();
    }
    for(const kind of changes.legacyAttachments?.removals??[]){const legacy=tx.select().from(notaFiscalLinks).where(eq(notaFiscalLinks.invoiceId,invoiceId)).get();if(legacy){const pointer=kind === "pdf" ? "pdfFileId" : "xmlFileId";tx.update(notaFiscalLinks).set({[pointer]:null,updatedAt:now}).where(eq(notaFiscalLinks.id,legacy.id)).run();}}
    const cas = tx.update(invoices).set({ workspaceRevision: nextRevision, updatedAt: now }).where(and(eq(invoices.id, invoiceId), eq(invoices.workspaceRevision, envelope.baseRevision))).returning({ id: invoices.id }).get();
    if (!cas) throw new WorkspaceConflictError("STALE_REVISION", "This invoice changed before the save could commit.");
    const nextSnapshot = workspaceSnapshot(invoiceId); const nextGeneration = envelope.baseGeneration + 1;
    tx.insert(invoiceEditGenerations).values({ sessionId: envelope.editSessionId, generation: nextGeneration, invoiceRevision: nextRevision, snapshotJson: JSON.stringify(nextSnapshot), createdAt: now }).run();
    tx.update(invoiceEditSessions).set({ currentGeneration: nextGeneration, expiresAt: expiresAt(), updatedAt: now }).where(eq(invoiceEditSessions.id, envelope.editSessionId)).run();
    const result: OperationResult = { outcome: "committed", operationId: envelope.operationId, kind: "save", digest, message: "Changes saved.", resultingRevision: nextRevision, resultingGeneration: nextGeneration, tempKeyMap };
    tx.update(invoiceOperations).set({ state: "committed", resultJson: JSON.stringify(result), leaseExpiresAt: null, updatedAt: now }).where(and(eq(invoiceOperations.invoiceId, invoiceId), eq(invoiceOperations.id, envelope.operationId), eq(invoiceOperations.fencingGeneration, claimGeneration))).run();
    return { ...result, normalized: { canonicalBase: nextSnapshot } };
  });
}

export function rebaseWorkspace(invoiceId: number, input: RebaseInput) {
  const expectedDigest = sha256Identity({ editSessionId: input.editSessionId, expectedBaseGeneration: input.expectedBaseGeneration, expectedLatestRevision: input.expectedLatestRevision, choices: input.choices });
  if (expectedDigest !== input.rebaseDigest) throw new WorkspaceConflictError("DIGEST_MISMATCH", "The rebase identity did not match.");
  const sessionBefore = db.select().from(invoiceEditSessions).where(and(eq(invoiceEditSessions.id, input.editSessionId), eq(invoiceEditSessions.invoiceId, invoiceId))).get();
  if (!sessionBefore) throw new WorkspaceConflictError("SESSION_SCOPE", "This edit session does not belong to this invoice.");
  if (sessionBefore.state !== "active" || sessionBefore.expiresAt <= nowIso()) throw new WorkspaceConflictError("SESSION_EXPIRED", "This editing session expired.");
  const priorBefore = db.select().from(invoiceRebases).where(and(eq(invoiceRebases.sessionId, input.editSessionId), eq(invoiceRebases.id, input.rebaseId))).get();
  if (priorBefore) {
    if (priorBefore.digest !== input.rebaseDigest) throw new WorkspaceConflictError("OPERATION_KEY_REUSED", "This rebase key was already used with different content.");
    db.update(invoiceEditSessions).set({ expiresAt: expiresAt(), updatedAt: nowIso() }).where(eq(invoiceEditSessions.id, input.editSessionId)).run();
    return JSON.parse(priorBefore.resultJson);
  }
  const unresolved = db.select().from(invoiceOperations).where(and(eq(invoiceOperations.invoiceId, invoiceId), eq(invoiceOperations.sessionId, input.editSessionId), eq(invoiceOperations.state, "processing"))).get();
  if (unresolved) return rejectRebase(input, "OPERATION_UNRESOLVED", "A save in this editing session is still being resolved.");
  const invoiceBefore = db.select().from(invoices).where(eq(invoices.id, invoiceId)).get();
  if (!invoiceBefore || sessionBefore.currentGeneration !== input.expectedBaseGeneration || invoiceBefore.workspaceRevision !== input.expectedLatestRevision) return rejectRebase(input, "REBASE_CONFLICT", "The invoice or editing base changed before rebase.");
  const baseBefore = db.select().from(invoiceEditGenerations).where(and(eq(invoiceEditGenerations.sessionId, input.editSessionId), eq(invoiceEditGenerations.generation, input.expectedBaseGeneration))).get();
  if (!baseBefore) return rejectRebase(input, "SESSION_EXPIRED", "The trusted editing base is unavailable.");
  const baseSnapshot = JSON.parse(baseBefore.snapshotJson) as Snapshot; const latestSnapshot = workspaceSnapshot(invoiceId);
  if (duplicates(input.choices.map((choice) => choice.path)) || input.choices.some((choice) => !validRebasePath(choice.path, baseSnapshot, latestSnapshot))) return rejectRebase(input, "INVALID_REBASE_CHOICES", "One or more rebase choices do not identify retained invoice data.");
  return db.transaction((tx) => {
    const scopedSession = tx.select().from(invoiceEditSessions).where(and(eq(invoiceEditSessions.id, input.editSessionId), eq(invoiceEditSessions.invoiceId, invoiceId))).get();
    if (!scopedSession) throw new WorkspaceConflictError("SESSION_SCOPE", "This edit session does not belong to this invoice.");
    const session = scopedSession;
    if (!session || session.state !== "active" || session.expiresAt <= nowIso()) throw new WorkspaceConflictError("SESSION_EXPIRED", "This editing session expired.");
    const prior = tx.select().from(invoiceRebases).where(and(eq(invoiceRebases.sessionId, input.editSessionId), eq(invoiceRebases.id, input.rebaseId))).get();
    if (prior) { if (prior.digest !== input.rebaseDigest) throw new WorkspaceConflictError("OPERATION_KEY_REUSED", "This rebase key was already used with different content."); tx.update(invoiceEditSessions).set({ expiresAt: expiresAt(), updatedAt: nowIso() }).where(eq(invoiceEditSessions.id, session.id)).run(); return JSON.parse(prior.resultJson); }
    const invoice = tx.select().from(invoices).where(eq(invoices.id, invoiceId)).get();
    if (!invoice || session.currentGeneration !== input.expectedBaseGeneration || invoice.workspaceRevision !== input.expectedLatestRevision) throw new WorkspaceConflictError("REBASE_CONFLICT", "The invoice or editing base changed before rebase.", invoice?.workspaceRevision, invoice?.status);
    const baseRow = tx.select().from(invoiceEditGenerations).where(and(eq(invoiceEditGenerations.sessionId, session.id), eq(invoiceEditGenerations.generation, session.currentGeneration))).get();
    if (!baseRow) throw new WorkspaceConflictError("SESSION_EXPIRED", "The trusted editing base is unavailable.");
    const base = JSON.parse(baseRow.snapshotJson) as Snapshot; const snapshot = workspaceSnapshot(invoiceId);
    if (duplicates(input.choices.map((choice) => choice.path)) || input.choices.some((choice) => !validRebasePath(choice.path, base, snapshot))) throw new WorkspaceConflictError("INVALID_REBASE_CHOICES", "One or more rebase choices do not identify retained invoice data.");
    const normalizedProposal = input.choices.map((choice) => ({ path: choice.path, resolution: choice.resolution, value: choice.resolution === "latest" ? valueAtRebasePath(choice.path, snapshot) : choice.value }));
    const from = session.currentGeneration; const to = from + 1; const now = nowIso();
    const result = { outcome: "committed", rebaseId: input.rebaseId, digest: input.rebaseDigest, fromGeneration: from, toGeneration: to, observedInvoiceRevision: invoice.workspaceRevision, normalizedProposal, retainedRecoveryMapping: normalizedProposal.filter((x) => x.path.startsWith("document") && x.resolution === "mine"), canonicalBase: snapshot };
    tx.insert(invoiceEditGenerations).values({ sessionId: session.id, generation: to, invoiceRevision: invoice.workspaceRevision, snapshotJson: JSON.stringify(snapshot), createdAt: now }).run();
    tx.update(invoiceEditSessions).set({ currentGeneration: to, expiresAt: expiresAt(), updatedAt: now }).where(and(eq(invoiceEditSessions.id, session.id), eq(invoiceEditSessions.currentGeneration, from))).run();
    tx.insert(invoiceRebases).values({ id: input.rebaseId, sessionId: session.id, digest: input.rebaseDigest, state: "committed", fromGeneration: from, toGeneration: to, resultJson: JSON.stringify(result), createdAt: now }).run();
    return result;
  });
}

function rejectRebase(input: RebaseInput, code: string, message: string): never {
  const result = { outcome: "rejected", rebaseId: input.rebaseId, digest: input.rebaseDigest, fromGeneration: input.expectedBaseGeneration, toGeneration: null, code, message };
  db.insert(invoiceRebases).values({ id: input.rebaseId, sessionId: input.editSessionId, digest: input.rebaseDigest, state: "rejected", fromGeneration: input.expectedBaseGeneration, toGeneration: null, resultJson: JSON.stringify(result), createdAt: nowIso() }).run();
  throw new WorkspaceConflictError(code, message);
}

export function rebaseResult(invoiceId: number, sessionId: string, rebaseId: string) {
  const session = db.select().from(invoiceEditSessions).where(and(eq(invoiceEditSessions.id, sessionId), eq(invoiceEditSessions.invoiceId, invoiceId))).get();
  if (!session || session.expiresAt <= nowIso()) return null;
  const result = db.select().from(invoiceRebases).where(and(eq(invoiceRebases.sessionId, sessionId), eq(invoiceRebases.id, rebaseId))).get();
  db.update(invoiceEditSessions).set({ expiresAt: expiresAt(), updatedAt: nowIso() }).where(eq(invoiceEditSessions.id, sessionId)).run();
  return result ? JSON.parse(result.resultJson) : undefined;
}

function validRebasePath(path: string, base: Snapshot, latest: Snapshot): boolean {
  if (["document.number","document.invoiceDate","document.pdfTemplateRevisionId","document.partySnapshots","setNotes","items.order"].includes(path)) return true;
  if (/^items\.tmp:[0-9a-f-]{36}$/i.test(path) || /^records\.tmp:[0-9a-f-]{36}$/i.test(path)) return true;
  let match = /^items\.id:(\d+)\.(name|value|source|notes|removed)$/.exec(path); if (match) return [...base.items,...latest.items].some((item) => item.id === Number(match![1]));
  match = /^records\.id:(\d+)(?:\.([a-z][a-z0-9_]*|removed))?$/.exec(path); if (match) { const record = [...base.records,...latest.records].find((item) => item.id === Number(match![1])); if (!record) return false; if (!match[2] || match[2] === "removed") return true; const defs = JSON.parse(record.definitionsSnapshotJson) as ReturnType<typeof parseRecordDefinitions>; return defs.fields.some((field) => field.key === match![2]); }
  match = /^generatedTexts\.([a-z][a-z0-9_]*)$/.exec(path); if (match) return [...base.generatedTexts,...latest.generatedTexts].some((text) => text.generatorKey === match![1]);
  match = /^attachments\.(\d+)\.(removed)$/.exec(path); if (match) return [...base.records,...latest.records].flatMap((record) => record.attachments).some((attachment) => attachment.id === Number(match![1]));
  return /^legacy\.(number|issueDate|verificationCode|publicUrl|notes)$/.test(path);
}

function valueAtRebasePath(path: string, snapshot: Snapshot): unknown {
  if (path === "document.number") return snapshot.invoice.number; if (path === "document.invoiceDate") return snapshot.invoice.invoiceDate; if (path === "document.pdfTemplateRevisionId") return snapshot.invoice.pdfTemplateRevisionId; if (path === "setNotes") return snapshot.invoice.notes ?? ""; if (path === "items.order") return snapshot.items.map((item) => `id:${item.id}`);
  let match = /^items\.id:(\d+)\.(name|value|source|notes|removed)$/.exec(path); if (match) { const item = snapshot.items.find((row) => row.id === Number(match![1])); return match[2] === "removed" ? !item : item?.[match[2] as "name"|"value"|"source"|"notes"]; }
  match = /^records\.id:(\d+)(?:\.([a-z][a-z0-9_]*|removed))?$/.exec(path); if (match) { const record = snapshot.records.find((row) => row.id === Number(match![1])); return match[2] === "removed" ? Boolean(record?.removedAt) : match[2] ? record?.values[match[2]] : record; }
  match = /^generatedTexts\.([a-z][a-z0-9_]*)$/.exec(path); if (match) return snapshot.generatedTexts.find((text) => text.generatorKey === match![1])?.content;
  match = /^legacy\.(number|issueDate|verificationCode|publicUrl|notes)$/.exec(path); if (match) return snapshot.legacy?.[match[1] as "nfNumber"];
  return undefined;
}

export function cancelEditSession(invoiceId: number, sessionId: string, baseGeneration: number) {
  return db.transaction((tx) => {
    const session = tx.select().from(invoiceEditSessions).where(and(eq(invoiceEditSessions.id, sessionId), eq(invoiceEditSessions.invoiceId, invoiceId))).get();
    if (!session) return { outcome: "cancelled" };
    const unresolved = tx.select().from(invoiceOperations).where(and(eq(invoiceOperations.invoiceId, invoiceId), eq(invoiceOperations.sessionId, sessionId), eq(invoiceOperations.state, "processing"))).get();
    if (unresolved) throw new WorkspaceConflictError("OPERATION_UNRESOLVED", "The editing session has an unresolved operation.");
    if (session.currentGeneration !== baseGeneration) throw new WorkspaceConflictError("STALE_GENERATION", "The editing base changed before cancellation.");
    tx.update(invoiceEditSessions).set({ state: "cancelled", updatedAt: nowIso() }).where(eq(invoiceEditSessions.id, sessionId)).run();
    tx.update(invoiceStagedFiles).set({ state: "released" }).where(and(eq(invoiceStagedFiles.sessionId, sessionId), eq(invoiceStagedFiles.state, "staged"))).run();
    return { outcome: "cancelled" };
  });
}

export async function stageWorkspaceFile(invoiceId: number, sessionId: string, uploadId: string, recordKey: string, definitionKey: string, upload: File) {
  if (recordKey === "legacy:nfse" && !["pdf", "xml"].includes(definitionKey)) throw new WorkspaceValidationError([{ path: "legacyAttachments", label: "Legacy attachment", message: "Choose PDF or XML for a legacy tax attachment.", section: "records" }]);
  if (recordKey !== "legacy:nfse" && definitionKey.match(/^(pdf|xml)$/) && recordKey.startsWith("legacy:")) throw new WorkspaceValidationError([{ path: "attachments", label: "Attachment", message: "This attachment binding is unavailable.", section: "records" }]);
  if (upload.size > 10 * 1024 * 1024) throw new WorkspaceValidationError([{ path: `attachments.${recordKey}.${definitionKey}`, label: upload.name, message: "Attachments must be 10 MiB or smaller.", section: "records" }]);
  const bytes = new Uint8Array(await upload.arrayBuffer()); const digest = createHash("sha256").update(bytes).digest("hex");
  const session = db.select().from(invoiceEditSessions).where(and(eq(invoiceEditSessions.id, sessionId), eq(invoiceEditSessions.invoiceId, invoiceId))).get();
  if (!session || session.state !== "active" || session.expiresAt <= nowIso()) throw new WorkspaceConflictError("SESSION_EXPIRED", "This editing session expired.");
  const duplicate = db.select().from(invoiceStagedFiles).where(and(eq(invoiceStagedFiles.sessionId, sessionId), eq(invoiceStagedFiles.uploadId, uploadId))).get();
  if (duplicate) { if (duplicate.invoiceId !== invoiceId || duplicate.digest !== digest || duplicate.recordKey !== recordKey || duplicate.definitionKey !== definitionKey || duplicate.mimeType !== (upload.type || null) || duplicate.originalFilename !== basename(upload.name || "attachment") || duplicate.sizeBytes !== upload.size) throw new WorkspaceConflictError("UPLOAD_KEY_REUSED", "This upload key was already used for another file identity."); return duplicate; }
  mkdirSync(paths.tmpDir, { recursive: true }); const token = randomUUID(); const storedPath = join(paths.tmpDir, `invoice-stage-${token}`); writeFileSync(storedPath, bytes);
  return db.insert(invoiceStagedFiles).values({ token, uploadId, sessionId, invoiceId, recordKey, definitionKey, digest, storedPath, originalFilename: basename(upload.name || "attachment"), mimeType: upload.type || null, sizeBytes: bytes.length, state: "staged", fencingGeneration: null, expiresAt: expiresAt(), createdAt: nowIso() }).returning().get();
}

export function ownedInvoiceFile(invoiceId: number, fileId: number) {
  const ownership = db.select().from(invoiceFileOwnership).where(and(eq(invoiceFileOwnership.invoiceId, invoiceId), eq(invoiceFileOwnership.fileId, fileId))).get();
  return ownership ? db.select().from(files).where(eq(files.id, fileId)).get() ?? null : null;
}

/** Immutable PDF history is deliberately read through the version row, never
 * inferred from the current archive pointer or a file kind. */
export function listInvoicePdfVersions(invoiceId: number) {
  return db.select({ version: invoicePdfVersions, file: files })
    .from(invoicePdfVersions)
    .innerJoin(files, eq(invoicePdfVersions.fileId, files.id))
    .where(eq(invoicePdfVersions.invoiceId, invoiceId))
    .orderBy(sql`${invoicePdfVersions.savedAt} desc`, sql`${invoicePdfVersions.id} desc`)
    .all();
}

function commandDigest(input: WorkspaceCommandInput) {
  return operationIdentity({ schemaVersion: 1, kind: input.kind, baseRevision: input.expectedRevision, arguments: input.arguments });
}

function rejectCommand(invoiceId: number, input: WorkspaceCommandInput, generation: number, code: string, message: string): OperationResult {
  const result: OperationResult = { outcome: "rejected", operationId: input.operationId, kind: input.kind, digest: input.canonicalPayloadDigest, code, message };
  const stored = db.update(invoiceOperations).set({ state: "rejected", resultJson: JSON.stringify(result), leaseExpiresAt: null, updatedAt: nowIso() }).where(and(eq(invoiceOperations.invoiceId, invoiceId), eq(invoiceOperations.id, input.operationId), eq(invoiceOperations.fencingGeneration, generation), eq(invoiceOperations.state, "processing"))).returning({ id: invoiceOperations.id }).get();
  return stored ? result : operationResult(invoiceId, input.operationId) ?? { outcome: "processing", operationId: input.operationId, kind: input.kind, digest: input.canonicalPayloadDigest, message: "Another worker is resolving this command." };
}

export async function executeWorkspaceCommand(invoiceId: number, input: WorkspaceCommandInput): Promise<OperationResult> {
  if(input.kind === "delete") return deleteDraftInvoiceCommand(invoiceId,input);
  const digest = commandDigest(input); if (digest !== input.canonicalPayloadDigest) throw new WorkspaceConflictError("DIGEST_MISMATCH", "The command payload identity did not match.");
  const claim = claimOperation(invoiceId, input.operationId, null, input.kind, digest); if (claim.replay) return claim.replay;
  const current = getInvoiceDetail(invoiceId); if (!current) return rejectCommand(invoiceId, input, claim.generation, "NOT_FOUND", "Invoice not found.");
  if (current.invoice.workspaceRevision !== input.expectedRevision) return rejectCommand(invoiceId, input, claim.generation, "STALE_REVISION", "This invoice changed before the command began.");
  if (input.kind === "status" || input.kind === "revert") return finalizeStatusCommand(invoiceId, input, claim.generation);
  if (input.kind === "issue" && (current.invoice.status !== "draft" || current.items.length === 0)) return rejectCommand(invoiceId, input, claim.generation, "INVALID_STATUS", current.items.length === 0 ? "Add at least one item before issuing." : "Only a draft invoice can be issued.");
  const dependencySignature = pdfRenderingDependencySignature(current);
  if (input.arguments.dependencySignature && input.arguments.dependencySignature !== dependencySignature) return rejectCommand(invoiceId, input, claim.generation, "DEPENDENCY_CONFLICT", "The captured PDF inputs changed before rendering.");
  let rendered: Awaited<ReturnType<typeof renderInvoicePdf>>;
  try { rendered = await renderInvoicePdf(current); } catch (error) { return rejectCommand(invoiceId, input, claim.generation, "RENDER_FAILED", error instanceof Error ? error.message : "The PDF could not be created."); }
  const year = current.invoice.invoiceDate.slice(0,4) || "unknown"; const destDir = join(paths.archivedInvoicesDir,year); mkdirSync(destDir,{recursive:true}); const safe = sanitizeFilename(rendered.filename.replace(/\.pdf$/i,"")) || `invoice-${invoiceId}`; const absolute = join(destDir,`${safe}-${randomUUID()}.pdf`); writeFileSync(absolute,rendered.buffer); const byteHash=createHash("sha256").update(rendered.buffer).digest("hex");
  try {
    return db.transaction((tx) => {
      const operation=tx.select().from(invoiceOperations).where(and(eq(invoiceOperations.invoiceId,invoiceId),eq(invoiceOperations.id,input.operationId))).get(); const replay=parseResult(operation?.resultJson??null);if(replay)return replay;if(!operation||operation.state!=="processing"||operation.fencingGeneration!==claim.generation)throw new WorkspaceConflictError("CLAIM_LOST","Another worker owns this command.");
      const fresh=tx.select().from(invoices).where(eq(invoices.id,invoiceId)).get();if(!fresh||fresh.workspaceRevision!==input.expectedRevision||(input.kind==="issue"&&fresh.status!=="draft"))throw new WorkspaceConflictError("STALE_REVISION","The invoice changed while the PDF was rendering.");
      const freshDetail=getInvoiceDetail(invoiceId);if(!freshDetail||pdfRenderingDependencySignature(freshDetail)!==dependencySignature)throw new WorkspaceConflictError("DEPENDENCY_CONFLICT","A PDF or filename dependency changed while rendering.");
      const now=nowIso();const stored=tx.insert(files).values({kind:"archived_invoice",originalFilename:null,storedPath:relative(paths.filesDir,absolute),mimeType:"application/pdf",sizeBytes:rendered.buffer.length,sha256:byteHash,deletedAt:null,supersededByFileId:null,createdAt:now}).returning().get();
      const previous=fresh.archivedPdfFileId;if(previous)tx.update(files).set({supersededByFileId:stored.id}).where(eq(files.id,previous)).run();
      tx.insert(invoiceFileOwnership).values({invoiceId,fileId:stored.id,purpose:"invoice_pdf",provenanceJson:JSON.stringify({operationId:input.operationId,sourceRevision:input.expectedRevision}),createdAt:now}).run();
      const version=tx.insert(invoicePdfVersions).values({invoiceId,fileId:stored.id,sourceRevision:input.expectedRevision,sourceStatus:fresh.status,invoiceNumber:fresh.number,templateRevisionId:fresh.pdfTemplateRevisionId,dependencySignature,fingerprintVersion:1,savedAt:now}).returning().get();
      const nextRevision=fresh.workspaceRevision+1;tx.update(invoices).set({archivedPdfFileId:stored.id,...(input.kind==="issue"?{status:"issued"}:{}),workspaceRevision:nextRevision,updatedAt:now}).where(and(eq(invoices.id,invoiceId),eq(invoices.workspaceRevision,input.expectedRevision))).run();
      const result:OperationResult={outcome:"committed",operationId:input.operationId,kind:input.kind,digest,message:input.kind==="issue"?"Invoice issued. A PDF version was saved and the document is locked.":"PDF version saved. Commercial status was not changed.",resultingRevision:nextRevision,normalized:{versionId:version.id,fileId:stored.id,sourceRevision:input.expectedRevision,savedAt:now,templateRevisionId:fresh.pdfTemplateRevisionId}};
      tx.update(invoiceOperations).set({state:"committed",resultJson:JSON.stringify(result),leaseExpiresAt:null,updatedAt:now}).where(and(eq(invoiceOperations.invoiceId,invoiceId),eq(invoiceOperations.id,input.operationId),eq(invoiceOperations.fencingGeneration,claim.generation))).run();return result;
    });
  } catch(error) { if(error instanceof WorkspaceConflictError)return rejectCommand(invoiceId,input,claim.generation,error.code,error.message);throw error; }
}

function finalizeStatusCommand(invoiceId: number, input: WorkspaceCommandInput, generation: number): OperationResult {
  return db.transaction((tx) => {
    const operation = tx.select().from(invoiceOperations).where(and(eq(invoiceOperations.invoiceId, invoiceId), eq(invoiceOperations.id, input.operationId))).get();
    const replay = parseResult(operation?.resultJson ?? null);
    if (replay) return replay;
    if (!operation || operation.fencingGeneration !== generation) throw new WorkspaceConflictError("CLAIM_LOST", "Another worker owns this command.");

    // Keep rejection in this transaction. Calling rejectCommand() here starts
    // a second transaction on the shared SQLite connection and can otherwise
    // make a terminal rejection depend on nested-transaction behaviour.
    const rejectHere = (code: string, message: string): OperationResult => {
      const result: OperationResult = { outcome: "rejected", operationId: input.operationId, kind: input.kind, digest: input.canonicalPayloadDigest, code, message };
      const changed = tx.update(invoiceOperations).set({ state: "rejected", resultJson: JSON.stringify(result), leaseExpiresAt: null, updatedAt: nowIso() }).where(and(eq(invoiceOperations.invoiceId, invoiceId), eq(invoiceOperations.id, input.operationId), eq(invoiceOperations.fencingGeneration, generation), eq(invoiceOperations.state, "processing"))).returning({ id: invoiceOperations.id }).get();
      if (!changed) throw new WorkspaceConflictError("CLAIM_LOST", "Another worker owns this command.");
      return result;
    };

    const invoice = tx.select().from(invoices).where(eq(invoices.id, invoiceId)).get();
    if (!invoice || invoice.workspaceRevision !== input.expectedRevision) return rejectHere("STALE_REVISION", "This invoice changed before the status command committed.");
    let status: string;
    if (input.kind === "revert") {
      if (invoice.status === "draft") return rejectHere("INVALID_STATUS", "This invoice is already a draft.");
      status = "draft";
    } else {
      status = input.arguments.status ?? "";
      if (!canManuallyTransition(invoice.status, status)) return rejectHere("INVALID_STATUS", `Cannot change status from ${invoice.status} to ${status}.`);
    }
    const now = nowIso(), nextRevision = invoice.workspaceRevision + 1;
    tx.update(invoices).set({ status, workspaceRevision: nextRevision, updatedAt: now }).where(and(eq(invoices.id, invoiceId), eq(invoices.workspaceRevision, input.expectedRevision))).run();
    const result: OperationResult = { outcome: "committed", operationId: input.operationId, kind: input.kind, digest: input.canonicalPayloadDigest, message: input.kind === "revert" ? "Invoice reverted to draft. Previous PDF versions remain available." : "Invoice status changed.", resultingRevision: nextRevision };
    tx.update(invoiceOperations).set({ state: "committed", resultJson: JSON.stringify(result), leaseExpiresAt: null, updatedAt: now }).where(and(eq(invoiceOperations.invoiceId, invoiceId), eq(invoiceOperations.id, input.operationId), eq(invoiceOperations.fencingGeneration, generation))).run();
    return result;
  });
}

export async function createSavedDataPreview(invoiceId:number,input:{previewId:string;sourceKind:"current-saved-data"|"saved-version"|"workspace-proposal";inputDigest:string;editSessionId?:string;baseGeneration?:number;proposal?:WorkspaceChanges}) {
  const detail=getInvoiceDetail(invoiceId);if(!detail)throw new WorkspaceConflictError("NOT_FOUND","Invoice not found.");
  let renderDetail=detail, sessionId:string|null=null, generation:number|null=null;
  if(input.sourceKind === "workspace-proposal") {
    if(!input.editSessionId||!input.baseGeneration||!input.proposal) throw new WorkspaceConflictError("INVALID_PREVIEW","This preview needs its scoped editing session.");
    const session=db.select().from(invoiceEditSessions).where(and(eq(invoiceEditSessions.id,input.editSessionId),eq(invoiceEditSessions.invoiceId,invoiceId))).get(); const baseRow=session&&db.select().from(invoiceEditGenerations).where(and(eq(invoiceEditGenerations.sessionId,session.id),eq(invoiceEditGenerations.generation,input.baseGeneration))).get();
    if(!session||session.state!=="active"||session.expiresAt<=nowIso()||!baseRow)throw new WorkspaceConflictError("SESSION_EXPIRED","This editing session expired.");
    const base=JSON.parse(baseRow.snapshotJson) as Snapshot; const expected=sha256Identity({invoiceId,editSessionId:input.editSessionId,baseGeneration:input.baseGeneration,proposal:input.proposal,sourceKind:input.sourceKind}); if(input.inputDigest!==expected)throw new WorkspaceConflictError("DIGEST_MISMATCH","The preview request no longer matches the proposed inputs."); const errors=validateChanges(base,input.proposal,base);if(errors.length)throw new WorkspaceValidationError(errors);
    const selections:ResolvedWorkspaceSelections={...(input.proposal.document?.partyRefreshDigest&&base.partyRefresh?{partyRefresh:base.partyRefresh}:{}),recordTypes:Object.fromEntries((input.proposal.records?.additions??[]).flatMap(addition=>{const type=base.availableRecordTypes.find(candidate=>candidate.id===addition.recordTypeId&&candidate.digest===addition.recordTypeSnapshotDigest);return type?[[addition.key,{recordTypeId:type.id,recordTypeKey:type.key,recordTypeName:type.name,purpose:type.purpose,definitionsSnapshotJson:type.definitionsSnapshotJson}]]:[]}))}; const projected=projectWorkspace(base as WorkspaceProjectionBase,input.proposal,selections);
    renderDetail={...detail,invoice:{...detail.invoice,...projected.invoice},items:projected.items.map(({rowKey,...item})=>({...item,invoiceId,createdAt:"",updatedAt:""})),total:projected.total,records:projected.activeRecords.map(record=>{const definitions=JSON.parse(record.definitionsSnapshotJson) as {fields:unknown[];attachments:unknown[]};return {...record,invoiceId,valuesJson:JSON.stringify(record.values),definitions,attachments:[],createdAt:"",updatedAt:""};}),notaFiscal:projected.legacy?{...(detail.notaFiscal??{id:0,invoiceId,pdfFileId:null,xmlFileId:null,createdAt:"",updatedAt:""}),...projected.legacy}:null} as unknown as typeof detail; sessionId=input.editSessionId;generation=input.baseGeneration;
  }
  const expectedDigest=input.sourceKind === "workspace-proposal" ? input.inputDigest : sha256Identity({invoiceId,revision:detail.invoice.workspaceRevision,sourceKind:input.sourceKind});
  if(input.inputDigest!==expectedDigest)throw new WorkspaceConflictError("DIGEST_MISMATCH","The preview request no longer matches the current saved invoice.");
  const signature=pdfRenderingDependencySignature(renderDetail);const rendered=await renderInvoicePdf(renderDetail);const dir=join(paths.filesDir,"previews");mkdirSync(dir,{recursive:true});const absolute=join(dir,`${input.previewId}.pdf`);writeFileSync(absolute,rendered.buffer);const hash=createHash("sha256").update(rendered.buffer).digest("hex"),now=nowIso(),expiry=new Date(Date.now()+60*60*1000).toISOString();return db.transaction((tx)=>{const stored=tx.insert(files).values({kind:"invoice_preview",originalFilename:null,storedPath:relative(paths.filesDir,absolute),mimeType:"application/pdf",sizeBytes:rendered.buffer.length,sha256:hash,deletedAt:null,supersededByFileId:null,createdAt:now}).returning().get();tx.insert(invoiceFileOwnership).values({invoiceId,fileId:stored.id,purpose:"invoice_preview",provenanceJson:JSON.stringify({previewId:input.previewId}),createdAt:now}).run();const preview=tx.insert(invoicePreviews).values({id:input.previewId,invoiceId,sessionId,workspaceRevision:detail.invoice.workspaceRevision,baseGeneration:generation,sourceKind:input.sourceKind,inputDigest:input.inputDigest,dependencySignature:signature,fileId:stored.id,byteHash:hash,expiresAt:expiry,createdAt:now}).returning().get();return{outcome:"ready",message:"PDF preview ready.",previewId:preview.id,inputDigest:preview.inputDigest,url:`/invoices/${invoiceId}/previews/${preview.id}`,expiresAt:expiry};});
}

export function getPreviewFile(invoiceId:number,previewId:string){const preview=db.select().from(invoicePreviews).where(and(eq(invoicePreviews.id,previewId),eq(invoicePreviews.invoiceId,invoiceId))).get();if(!preview||preview.expiresAt&&preview.expiresAt<=nowIso())return null;const file=ownedInvoiceFile(invoiceId,preview.fileId);return file?{preview,file}:null;}

export function generateWorkspaceCandidate(invoiceId:number,sessionId:string,input:{sequence:number;inputDigest:string;generatorKey:string;proposal:WorkspaceChanges}) {
  const expected=sha256Identity({key:input.generatorKey,proposal:input.proposal});if(expected!==input.inputDigest)throw new WorkspaceConflictError("DIGEST_MISMATCH","The generation request no longer matches the proposed inputs.");
  const session=db.select().from(invoiceEditSessions).where(and(eq(invoiceEditSessions.id,sessionId),eq(invoiceEditSessions.invoiceId,invoiceId))).get();if(!session||session.state!=="active"||session.expiresAt<=nowIso())throw new WorkspaceConflictError("SESSION_EXPIRED","This editing session expired.");
  const detail=getInvoiceDetail(invoiceId);if(!detail)throw new WorkspaceConflictError("NOT_FOUND","Invoice not found.");const generator=detail.textGenerators.find((item)=>item.key===input.generatorKey);if(!generator)throw new WorkspaceConflictError("GENERATOR_UNAVAILABLE","This generator is archived or unavailable. Its saved text remains editable."); const baseRow=db.select().from(invoiceEditGenerations).where(and(eq(invoiceEditGenerations.sessionId,sessionId),eq(invoiceEditGenerations.generation,session.currentGeneration))).get();if(!baseRow)throw new WorkspaceConflictError("SESSION_EXPIRED","This editing base expired.");const base=JSON.parse(baseRow.snapshotJson) as Snapshot;const projected=projectWorkspace(base as WorkspaceProjectionBase,input.proposal);
  const candidate=generateText(generator,{...detail,invoice:{...detail.invoice,...projected.invoice},items:projected.items.map(({rowKey,...item})=>({...item,invoiceId,createdAt:"",updatedAt:""})),total:projected.total});db.update(invoiceEditSessions).set({expiresAt:expiresAt(),updatedAt:nowIso()}).where(eq(invoiceEditSessions.id,sessionId)).run();return{outcome:"ready",message:"Generated candidate ready. Review it before replacing your text.",sequence:input.sequence,inputDigest:input.inputDigest,candidate};
}
