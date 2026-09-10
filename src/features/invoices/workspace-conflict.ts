import type { WorkspaceChanges } from "./invoice-workspace.schema.ts";
import type { Snapshot } from "./invoice-workspace.service.ts";

export type WorkspaceComparison = { path: string; kind: "field" | "row" | "order" | "temporary"; base: unknown; latest: unknown; proposed: unknown; conflict: boolean };

/** Typed, row-aware comparison used for conflict controls and rebase receipts. */
export function compareWorkspace(base: Snapshot, latest: Snapshot, changes: WorkspaceChanges): WorkspaceComparison[] {
  const rows: WorkspaceComparison[] = [];
  const add = (path: string, kind: WorkspaceComparison["kind"], before: unknown, current: unknown, proposed: unknown) => rows.push({ path, kind, base: before, latest: current, proposed, conflict: JSON.stringify(before) !== JSON.stringify(current) && JSON.stringify(proposed) !== JSON.stringify(current) });
  for (const [key, value] of Object.entries(changes.document ?? {})) add(`document.${key === "partyRefreshDigest" ? "partySnapshots" : key}`, "field", key === "partyRefreshDigest" ? { issuer: base.invoice.issuerSnapshotJson, client: base.invoice.clientSnapshotJson } : base.invoice[key as keyof typeof base.invoice], key === "partyRefreshDigest" ? { issuer: latest.invoice.issuerSnapshotJson, client: latest.invoice.clientSnapshotJson } : latest.invoice[key as keyof typeof latest.invoice], value);
  if (changes.setNotes !== undefined) add("setNotes", "field", base.invoice.notes, latest.invoice.notes, changes.setNotes);
  for (const update of changes.items?.updates ?? []) { const before=base.items.find(item=>item.id===update.id), current=latest.items.find(item=>item.id===update.id); for (const [key,value] of Object.entries(update.value)) add(`items.id:${update.id}.${key}`, "field", before?.[key as keyof typeof before], current?.[key as keyof typeof current], value); }
  for (const id of changes.items?.removals ?? []) add(`items.id:${id}.removed`, "row", base.items.some(item=>item.id===id), latest.items.some(item=>item.id===id), true);
  for (const addition of changes.items?.additions ?? []) add(`items.${addition.key}`, "temporary", null, null, addition.value);
  if (changes.items) add("items.order", "order", base.items.map(item=>`id:${item.id}`), latest.items.map(item=>`id:${item.id}`), changes.items.order);
  for (const text of changes.generatedTexts ?? []) add(`generatedTexts.${text.generatorKey}`, "field", base.generatedTexts.find(item=>item.generatorKey===text.generatorKey)?.content, latest.generatedTexts.find(item=>item.generatorKey===text.generatorKey)?.content, text.setContent);
  for (const update of changes.records?.updates ?? []) { const before=base.records.find(item=>item.id===update.id),current=latest.records.find(item=>item.id===update.id); for(const [key,value] of Object.entries(update.setFields)) add(`records.id:${update.id}.${key}`,"field",before?.values[key],current?.values[key],value); for(const key of update.clearFields)add(`records.id:${update.id}.${key}`,"field",before?.values[key],current?.values[key],null); }
  for(const id of changes.records?.removals??[]) add(`records.id:${id}.removed`,"row",base.records.find(item=>item.id===id)?.removedAt===null,latest.records.find(item=>item.id===id)?.removedAt===null,true);
  for(const addition of changes.records?.additions??[])add(`records.${addition.key}`,"temporary",null,null,addition.setFields);
  for(const [key,value] of Object.entries(changes.legacy?.setFields??{}))add(`legacy.${key}`,"field",base.legacy?.[key === "number" ? "nfNumber" : key as keyof NonNullable<typeof base.legacy>],latest.legacy?.[key === "number" ? "nfNumber" : key as keyof NonNullable<typeof latest.legacy>],value);
  return rows;
}
