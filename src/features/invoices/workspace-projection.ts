import { parseMoneyToMinor } from "../../domain/money.ts";
import type { WorkspaceChanges } from "./invoice-workspace.schema.ts";

/**
 * The one interpretation of an editor proposal.  This deliberately receives
 * only captured data: callers resolve ownership and template/record choices
 * before calling it.  It is safe to use for Save, PDF preview and text
 * generation without accidentally consulting current defaults.
 */
export type WorkspaceProjectionBase = {
  invoice: { id: number; number: string; invoiceDate: string; currency: string; notes: string | null; pdfTemplateRevisionId: number | null; issuerSnapshotJson: string | null; clientSnapshotJson: string | null };
  items: Array<{ id: number; name: string; value: number; source: string; notes: string | null; position: number }>;
  generatedTexts: Array<{ id: number; generatorKey: string; generatorName: string; sourceSnapshot: string; content: string }>;
  records: Array<{ id: number; recordTypeId: number | null; recordTypeKey: string; recordTypeName: string; purpose: string; definitionsSnapshotJson: string; values: Record<string, string | boolean>; removedAt: string | null }>;
  legacy: { id: number; nfNumber: string | null; issueDate: string | null; verificationCode: string | null; publicUrl: string | null; notes: string | null } | null;
};

export type ResolvedWorkspaceSelections = {
  partyRefresh?: { issuerSnapshotJson: string; clientSnapshotJson: string };
  recordTypes: Record<string, { recordTypeId: number; recordTypeKey: string; recordTypeName: string; purpose: string; definitionsSnapshotJson: string }>;
};

export function projectWorkspace(base: WorkspaceProjectionBase, changes: WorkspaceChanges, selections: ResolvedWorkspaceSelections = { recordTypes: {} }) {
  const document = changes.document;
  const invoice = {
    ...base.invoice,
    ...(document?.number !== undefined ? { number: document.number.trim().toUpperCase() } : {}),
    ...(document?.invoiceDate !== undefined ? { invoiceDate: document.invoiceDate } : {}),
    ...(document?.pdfTemplateRevisionId !== undefined ? { pdfTemplateRevisionId: document.pdfTemplateRevisionId } : {}),
    ...(changes.setNotes !== undefined ? { notes: changes.setNotes === "" ? null : changes.setNotes } : {}),
    ...(document?.partyRefreshDigest && selections.partyRefresh ? selections.partyRefresh : {}),
  };
  const updates = new Map((changes.items?.updates ?? []).map((change) => [change.id, change.value]));
  const removals = new Set(changes.items?.removals ?? []);
  const items = base.items.filter((item) => !removals.has(item.id)).map((item) => {
    const value = updates.get(item.id);
    return value ? { ...item, name: value.name.trim(), value: parseMoneyToMinor(value.value, invoice.currency)!, source: value.source, notes: value.notes } : { ...item };
  });
  const additions = changes.items?.additions ?? [];
  for (const addition of additions) items.push({ id: 0, name: addition.value.name.trim(), value: parseMoneyToMinor(addition.value.value, invoice.currency)!, source: addition.value.source, notes: addition.value.notes, position: items.length });
  const ordered = new Map<string, typeof items[number]>();
  for (const item of items) if (item.id) ordered.set(`id:${item.id}`, item);
  additions.forEach((addition, index) => ordered.set(addition.key, items[items.length - additions.length + index]!));
  const itemOrder = changes.items?.order ?? items.map((item) => item.id ? `id:${item.id}` : "");
  const projectedItems = itemOrder.map((key, position) => ({ ...ordered.get(key)!, position, rowKey: key }));
  const textChanges = new Map((changes.generatedTexts ?? []).map((text) => [text.generatorKey, text]));
  const generatedTexts = base.generatedTexts.map((text) => textChanges.has(text.generatorKey) ? { ...text, content: textChanges.get(text.generatorKey)!.setContent, generatorName: textChanges.get(text.generatorKey)!.generatorName, sourceSnapshot: textChanges.get(text.generatorKey)!.sourceSnapshot } : { ...text });
  for (const text of changes.generatedTexts ?? []) if (!base.generatedTexts.some((saved) => saved.generatorKey === text.generatorKey)) generatedTexts.push({ id: 0, generatorKey: text.generatorKey, generatorName: text.generatorName, sourceSnapshot: text.sourceSnapshot, content: text.setContent });
  const recordUpdates = new Map((changes.records?.updates ?? []).map((record) => [record.id, record]));
  const recordRemovals = new Set(changes.records?.removals ?? []);
  const records = base.records.map((record) => { const update = recordUpdates.get(record.id); const values = { ...record.values, ...(update?.setFields ?? {}) }; for (const key of update?.clearFields ?? []) delete values[key]; return { ...record, values, removedAt: recordRemovals.has(record.id) ? "__pending_removal__" : record.removedAt }; });
  for (const addition of changes.records?.additions ?? []) { const type = selections.recordTypes[addition.key]; if (type) records.push({ id: 0, recordTypeId: type.recordTypeId, recordTypeKey: type.recordTypeKey, recordTypeName: type.recordTypeName, purpose: type.purpose, definitionsSnapshotJson: type.definitionsSnapshotJson, values: { ...addition.setFields }, removedAt: null }); }
  const fieldMap: Record<string, keyof NonNullable<WorkspaceProjectionBase["legacy"]>> = { number: "nfNumber", issueDate: "issueDate", verificationCode: "verificationCode", publicUrl: "publicUrl", notes: "notes" };
  let legacy = base.legacy ? { ...base.legacy } : null;
  if (changes.legacy) { legacy ??= { id: 0, nfNumber: null, issueDate: null, verificationCode: null, publicUrl: null, notes: null }; for (const [key, value] of Object.entries(changes.legacy.setFields)) { const target = fieldMap[key]; if (target) legacy[target] = value as never; } for (const key of changes.legacy.clearFields) { const target = fieldMap[key]; if (target) legacy[target] = null as never; } }
  return { invoice, items: projectedItems, total: projectedItems.reduce((sum, item) => sum + item.value, 0), generatedTexts, records, activeRecords: records.filter((record) => !record.removedAt), legacy };
}
