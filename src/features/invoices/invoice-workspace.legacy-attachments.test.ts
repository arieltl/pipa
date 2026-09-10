import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { clients, files, invoiceItems, invoiceSequences, invoices, notaFiscalLinks } from "../../db/schema.ts";
import { nowIso } from "../../domain/dates.ts";
import { operationIdentity } from "../../domain/invoice-workspace.ts";
import { createInvoice, getInvoiceDetail } from "./invoices.service.ts";
import { createEditSession, saveWorkspace, stageWorkspaceFile } from "./invoice-workspace.service.ts";

beforeEach(() => {
  db.delete(invoiceItems).run(); db.delete(invoices).run(); db.delete(invoiceSequences).run(); db.delete(clients).run(); db.delete(files).run();
});

function fixture() {
  const now = nowIso();
  const client = db.insert(clients).values({ name: "Legacy files", code: `L${crypto.randomUUID().slice(0, 8)}`, defaultCurrency: "GBP", numberingProfileId: 1, createdAt: now, updatedAt: now }).returning().get();
  const invoice = createInvoice({ clientId: client.id, invoiceDate: "2026-09-09", currency: "GBP", items: [{ name: "Work", value: "1.00", source: "other" }] });
  const detail = getInvoiceDetail(invoice.id)!;
  const sessionId = crypto.randomUUID(); createEditSession(invoice.id, sessionId, detail.invoice.workspaceRevision);
  return { invoiceId: invoice.id, sessionId, revision: detail.invoice.workspaceRevision };
}

function save(invoiceId: number, sessionId: string, revision: number, changes: Record<string, unknown>) {
  const raw = { schemaVersion: 1 as const, operationId: crypto.randomUUID(), editSessionId: sessionId, baseGeneration: 1, baseRevision: revision, kind: "save" as const, changes };
  return saveWorkspace(invoiceId, { ...raw, canonicalPayloadDigest: operationIdentity(raw) } as any);
}

describe("workspace legacy NFS-e attachments", () => {
  test("replaces legacy PDF and saves notes in one aggregate commit while retaining old bytes", async () => {
    const { invoiceId, sessionId, revision } = fixture();
    const first = await stageWorkspaceFile(invoiceId, sessionId, crypto.randomUUID(), "legacy:nfse", "pdf", new File(["old"], "old.pdf", { type: "application/pdf" }));
    expect(save(invoiceId, sessionId, revision, { legacyAttachments: { additions: [{ kind: "pdf", token: first.token }], removals: [] } })).toMatchObject({ outcome: "committed" });
    const initial = getInvoiceDetail(invoiceId)!; const oldFileId = initial.notaFiscalPdf!.id;
    const replacementSession = crypto.randomUUID(); createEditSession(invoiceId, replacementSession, initial.invoice.workspaceRevision);
    const second = await stageWorkspaceFile(invoiceId, replacementSession, crypto.randomUUID(), "legacy:nfse", "pdf", new File(["new"], "new.pdf", { type: "application/pdf" }));
    const result = save(invoiceId, replacementSession, initial.invoice.workspaceRevision, { setNotes: "saved with replacement", legacyAttachments: { additions: [{ kind: "pdf", token: second.token }], removals: [] } });
    expect(result).toMatchObject({ outcome: "committed" });
    const saved = getInvoiceDetail(invoiceId)!;
    expect(saved.invoice.notes).toBe("saved with replacement"); expect(saved.notaFiscalPdf!.id).not.toBe(oldFileId);
    expect(db.select().from(files).where(eq(files.id, oldFileId)).get()?.supersededByFileId).toBe(saved.notaFiscalPdf!.id);
  });

  test("explicit removal clears only the pointer and rejects foreign, wrong-kind staged tokens", async () => {
    const { invoiceId, sessionId, revision } = fixture();
    const staged = await stageWorkspaceFile(invoiceId, sessionId, crypto.randomUUID(), "legacy:nfse", "xml", new File(["xml"], "notice.xml", { type: "application/xml" }));
    expect(save(invoiceId, sessionId, revision, { legacyAttachments: { additions: [{ kind: "xml", token: staged.token }], removals: [] } })).toMatchObject({ outcome: "committed" });
    const afterAdd = getInvoiceDetail(invoiceId)!; const oldFile = afterAdd.notaFiscalXml!;
    const removeSession = crypto.randomUUID(); createEditSession(invoiceId, removeSession, afterAdd.invoice.workspaceRevision);
    expect(save(invoiceId, removeSession, afterAdd.invoice.workspaceRevision, { setNotes: "removed with note", legacyAttachments: { additions: [], removals: ["xml"] } })).toMatchObject({ outcome: "committed" });
    expect(getInvoiceDetail(invoiceId)!.notaFiscalXml).toBeNull();
    expect(db.select().from(files).where(eq(files.id, oldFile.id)).get()).not.toBeNull();

    const other = fixture();
    const foreign = await stageWorkspaceFile(other.invoiceId, other.sessionId, crypto.randomUUID(), "legacy:nfse", "pdf", new File(["pdf"], "foreign.pdf", { type: "application/pdf" }));
    const badSession = crypto.randomUUID(); createEditSession(invoiceId, badSession, getInvoiceDetail(invoiceId)!.invoice.workspaceRevision);
    const wrongScope = save(invoiceId, badSession, getInvoiceDetail(invoiceId)!.invoice.workspaceRevision, { legacyAttachments: { additions: [{ kind: "pdf", token: foreign.token }], removals: [] } });
    expect(wrongScope).toMatchObject({ outcome: "rejected", code: "VALIDATION" });
    const wrongKind = await stageWorkspaceFile(invoiceId, badSession, crypto.randomUUID(), "legacy:nfse", "xml", new File(["xml"], "wrong.xml", { type: "application/xml" }));
    const rejected = save(invoiceId, badSession, getInvoiceDetail(invoiceId)!.invoice.workspaceRevision, { legacyAttachments: { additions: [{ kind: "pdf", token: wrongKind.token }], removals: [] } });
    expect(rejected).toMatchObject({ outcome: "rejected", code: "VALIDATION" });
  });
});
