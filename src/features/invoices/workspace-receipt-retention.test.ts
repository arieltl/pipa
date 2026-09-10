import { beforeEach, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { clients, invoiceItems, invoiceOperations, invoiceSequences, invoices } from "../../db/schema.ts";
import { operationIdentity } from "../../domain/invoice-workspace.ts";
import { createInvoice, getInvoiceDetail } from "./invoices.service.ts";
import { createEditSession, operationResult, saveWorkspace } from "./invoice-workspace.service.ts";

beforeEach(() => { db.delete(invoiceItems).run(); db.delete(invoices).run(); db.delete(invoiceSequences).run(); db.delete(clients).run(); });

test("lifetime rejected save receipt omits stale-conflict snapshots and submitted plaintext", () => {
  const now = "2026-09-09T00:00:00.000Z";
  const client = db.insert(clients).values({ name: "Receipt client", code: `RC${crypto.randomUUID().slice(0, 8)}`, defaultCurrency: "GBP", numberingProfileId: 1, partyFieldsJson: "[]", isDefault: false, createdAt: now, updatedAt: now }).returning().get();
  const invoice = createInvoice({ clientId: client.id, invoiceDate: "2026-09-09", currency: "GBP", items: [{ name: "Work", value: "1.00", source: "other" }] });
  const opened = getInvoiceDetail(invoice.id)!;
  const sessionId = crypto.randomUUID();
  createEditSession(invoice.id, sessionId, opened.invoice.workspaceRevision);
  // Simulates another writer's committed data with a distinctive secret that
  // must live only in lease-limited generation data, never the lifetime receipt.
  db.update(invoices).set({ notes: "CONFLICT-PRIVATE-CURRENT-SNAPSHOT", workspaceRevision: 1 }).where(eq(invoices.id, invoice.id)).run();
  const raw = { schemaVersion: 1 as const, operationId: crypto.randomUUID(), editSessionId: sessionId, baseGeneration: 1, baseRevision: 0, kind: "save" as const, changes: { setNotes: "SUBMITTED-PRIVATE-PROPOSAL" } };
  const result = saveWorkspace(invoice.id, { ...raw, canonicalPayloadDigest: operationIdentity(raw) } as any);
  expect(result).toMatchObject({ outcome: "rejected", code: "STALE_REVISION" });
  expect((result as any).conflict.currentSaved.invoice.notes).toBe("CONFLICT-PRIVATE-CURRENT-SNAPSHOT");

  const stored = db.select({ resultJson: invoiceOperations.resultJson }).from(invoiceOperations).where(eq(invoiceOperations.id, raw.operationId)).get()!.resultJson!;
  expect(stored).not.toContain("CONFLICT-PRIVATE-CURRENT-SNAPSHOT");
  expect(stored).not.toContain("SUBMITTED-PRIVATE-PROPOSAL");
  expect(JSON.parse(stored)).toMatchObject({ outcome: "rejected", operationId: raw.operationId, code: "STALE_REVISION" });
  db.update(invoices).set({ notes: "LATER-WRITER", workspaceRevision: 2 }).where(eq(invoices.id, invoice.id)).run();
  expect((operationResult(invoice.id, raw.operationId) as any).conflict.currentSaved.invoice.notes).toBe("CONFLICT-PRIVATE-CURRENT-SNAPSHOT");
  expect((saveWorkspace(invoice.id, { ...raw, canonicalPayloadDigest: operationIdentity(raw) } as any) as any).conflict.currentSaved.invoice.notes).toBe("CONFLICT-PRIVATE-CURRENT-SNAPSHOT");
});

test("lifetime committed save receipt omits submitted plaintext while lease-limited bases retain it", () => {
  const now = "2026-09-09T00:00:00.000Z";
  const client = db.insert(clients).values({ name: "Committed receipt", code: `CR${crypto.randomUUID().slice(0, 8)}`, defaultCurrency: "GBP", numberingProfileId: 1, partyFieldsJson: "[]", isDefault: false, createdAt: now, updatedAt: now }).returning().get();
  const invoice = createInvoice({ clientId: client.id, invoiceDate: "2026-09-09", currency: "GBP", items: [{ name: "Work", value: "1.00", source: "other" }] });
  const opened = getInvoiceDetail(invoice.id)!; const sessionId = crypto.randomUUID();
  createEditSession(invoice.id, sessionId, opened.invoice.workspaceRevision);
  const raw = { schemaVersion: 1 as const, operationId: crypto.randomUUID(), editSessionId: sessionId, baseGeneration: 1, baseRevision: 0, kind: "save" as const, changes: { setNotes: "COMMITTED-PRIVATE-PROPOSAL" } };
  expect(saveWorkspace(invoice.id, { ...raw, canonicalPayloadDigest: operationIdentity(raw) } as any)).toMatchObject({ outcome: "committed" });
  const stored = db.select({ resultJson: invoiceOperations.resultJson }).from(invoiceOperations).where(eq(invoiceOperations.id, raw.operationId)).get()!.resultJson!;
  expect(stored).not.toContain("COMMITTED-PRIVATE-PROPOSAL");
  expect(JSON.parse(stored)).toMatchObject({ outcome: "committed", operationId: raw.operationId, resultingGeneration: 2 });
});

test("an aborted aggregate save rolls back child and revision writes and records a truthful terminal receipt", () => {
  const now = "2026-09-09T00:00:00.000Z";
  const client = db.insert(clients).values({ name: "Abort receipt", code: `AR${crypto.randomUUID().slice(0, 8)}`, defaultCurrency: "GBP", numberingProfileId: 1, partyFieldsJson: "[]", isDefault: false, createdAt: now, updatedAt: now }).returning().get();
  const invoice = createInvoice({ clientId: client.id, invoiceDate: "2026-09-09", currency: "GBP", items: [{ name: "Initial", value: "1.00", source: "other" }] });
  const opened = getInvoiceDetail(invoice.id)!; const sessionId = crypto.randomUUID();
  createEditSession(invoice.id, sessionId, opened.invoice.workspaceRevision);
  const raw = { schemaVersion: 1 as const, operationId: crypto.randomUUID(), editSessionId: sessionId, baseGeneration: 1, baseRevision: 0, kind: "save" as const, changes: { items: { updates: [], additions: [{ key: "tmp:abort", value: { name: "Must roll back", value: "2.00", source: "other", notes: null } }], removals: [], order: ["id:" + opened.items[0]!.id, "tmp:abort"] } } };
  db.run(sql.raw("CREATE TRIGGER abort_workspace_save BEFORE UPDATE OF workspace_revision ON invoices BEGIN SELECT RAISE(ABORT, 'save fence failed'); END;"));
  try {
    expect(() => saveWorkspace(invoice.id, { ...raw, canonicalPayloadDigest: operationIdentity(raw) } as any)).not.toThrow();
    expect(db.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, invoice.id)).all()).toHaveLength(1);
    expect(db.select({ revision: invoices.workspaceRevision }).from(invoices).where(eq(invoices.id, invoice.id)).get()!.revision).toBe(0);
    expect(operationResult(invoice.id, raw.operationId)).toMatchObject({ outcome: "rejected" });
  } finally { db.run(sql.raw("DROP TRIGGER IF EXISTS abort_workspace_save")); }
});
