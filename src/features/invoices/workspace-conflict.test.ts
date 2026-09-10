import { describe, expect, test } from "bun:test";
import { compareWorkspace } from "./workspace-conflict.ts";
import type { Snapshot } from "./invoice-workspace.service.ts";

const snapshot = (revision: number, itemName = "Work") => ({ invoice: { id: 1, number: "I-1", invoiceDate: "2026-09-01", currency: "USD", status: "draft", notes: null, pdfTemplateRevisionId: null, issuerSnapshotJson: null, clientSnapshotJson: null, workspaceRevision: revision }, items: [{ id: 1, name: itemName, value: 100, source: "other", notes: null, position: 0 }], generatedTexts: [], records: [], legacy: null, partyRefresh: null, availableRecordTypes: [] }) as Snapshot;

describe("compareWorkspace", () => {
  test("uses stable paths and distinguishes a real field conflict from independent row edits", () => {
    const rows = compareWorkspace(snapshot(1), snapshot(2, "Elsewhere"), { items: { updates: [{ id: 1, value: { name: "Mine", value: "1.00", source: "other", notes: null } }], additions: [{ key: "tmp:00000000-0000-4000-8000-000000000001", value: { name: "New", value: "2.00", source: "other", notes: null } }], removals: [], order: ["id:1", "tmp:00000000-0000-4000-8000-000000000001"] } });
    expect(rows.find(row => row.path === "items.id:1.name")?.conflict).toBe(true);
    expect(rows.find(row => row.path.includes("tmp:"))).toMatchObject({ kind: "temporary", conflict: false });
    expect(rows.find(row => row.path === "items.id:1.value")?.conflict).toBe(false);
  });
});
