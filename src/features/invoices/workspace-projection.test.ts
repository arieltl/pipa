import { describe, expect, test } from "bun:test";
import { projectWorkspace, type WorkspaceProjectionBase } from "./workspace-projection.ts";

const base: WorkspaceProjectionBase = {
  invoice: { id: 1, number: "OLD", invoiceDate: "2026-09-01", currency: "USD", notes: null, pdfTemplateRevisionId: 2, issuerSnapshotJson: "old-issuer", clientSnapshotJson: "old-client" },
  items: [{ id: 7, name: "Work", value: 1200, source: "other", notes: null, position: 0 }],
  generatedTexts: [{ id: 9, generatorKey: "email", generatorName: "Email", sourceSnapshot: "saved", content: "old" }],
  records: [{ id: 4, recordTypeId: 3, recordTypeKey: "nfse", recordTypeName: "Tax", purpose: "nfse", definitionsSnapshotJson: '{"fields":[],"attachments":[]}', values: { number: "A" }, removedAt: null }],
  legacy: { id: 2, nfNumber: "N-1", issueDate: null, verificationCode: null, publicUrl: null, notes: null },
};

describe("projectWorkspace", () => {
  test("projects integer money, row order, text, records, legacy, parties and template without mutating its base", () => {
    const proposed = projectWorkspace(base, { document: { number: " next ", pdfTemplateRevisionId: 8, partyRefreshDigest: "a".repeat(64) }, items: { updates: [{ id: 7, value: { name: "Updated", value: "13.50", source: "expense", notes: "n" } }], additions: [{ key: "tmp:00000000-0000-4000-8000-000000000001", value: { name: "New", value: "2.25", source: "other", notes: null } }], removals: [], order: ["tmp:00000000-0000-4000-8000-000000000001", "id:7"] }, setNotes: "note", generatedTexts: [{ generatorKey: "email", generatorName: "Email", sourceSnapshot: "saved", setContent: "new" }], records: { updates: [{ id: 4, setFields: { number: "B" }, clearFields: [] }], additions: [], removals: [] }, legacy: { setFields: { number: "N-2" }, clearFields: [] } }, { partyRefresh: { issuerSnapshotJson: "new-issuer", clientSnapshotJson: "new-client" }, recordTypes: {} });
    expect(proposed.invoice).toMatchObject({ number: "NEXT", pdfTemplateRevisionId: 8, notes: "note", issuerSnapshotJson: "new-issuer" });
    expect(proposed.items.map((item) => [item.rowKey, item.value])).toEqual([["tmp:00000000-0000-4000-8000-000000000001", 225], ["id:7", 1350]]);
    expect(proposed.total).toBe(1575);
    expect(proposed.generatedTexts[0]?.content).toBe("new");
    expect(proposed.activeRecords[0]?.values.number).toBe("B");
    expect(proposed.legacy?.nfNumber).toBe("N-2");
    expect(base.items[0]?.value).toBe(1200);
  });
});
