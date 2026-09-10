import { beforeEach, expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { paths } from "../../config/paths.ts";
import { clients, invoiceEditGenerations, invoiceEditSessions, invoiceItems, invoiceOperations, invoiceRebases, invoiceSequences, invoiceStagedFiles, invoices } from "../../db/schema.ts";
import { nowIso } from "../../domain/dates.ts";
import { createInvoice, getInvoiceDetail } from "./invoices.service.ts";
import { maintainWorkspaceState } from "./invoice-workspace.maintenance.ts";
import { createEditSession, stageWorkspaceFile } from "./invoice-workspace.service.ts";

beforeEach(() => { db.delete(invoiceItems).run(); db.delete(invoices).run(); db.delete(invoiceSequences).run(); db.delete(clients).run(); });

async function stagedFixture() {
  const now = nowIso(); const client = db.insert(clients).values({ name: "Maintenance", code: `M${crypto.randomUUID().slice(0, 8)}`, defaultCurrency: "GBP", numberingProfileId: 1, partyFieldsJson: "[]", isDefault: false, createdAt: now, updatedAt: now }).returning().get();
  const invoice = createInvoice({ clientId: client.id, invoiceDate: "2026-09-09", currency: "GBP", items: [{ name: "Work", value: "1.00", source: "other" }] });
  const detail = getInvoiceDetail(invoice.id)!; const sessionId = crypto.randomUUID(); createEditSession(invoice.id, sessionId, detail.invoice.workspaceRevision);
  const staged = await stageWorkspaceFile(invoice.id, sessionId, crypto.randomUUID(), "legacy:nfse", "pdf", new File(["staged"], "staged.pdf", { type: "application/pdf" }));
  return { invoice, sessionId, staged };
}

test("maintenance durably releases only expired uncommitted staging, unlinks it, and prunes its lease-limited session", async () => {
  const { sessionId, staged } = await stagedFixture(); const past = "2000-01-01T00:00:00.000Z";
  db.update(invoiceStagedFiles).set({ expiresAt: past }).where(eq(invoiceStagedFiles.token, staged.token)).run();
  db.update(invoiceEditSessions).set({ state: "cancelled", expiresAt: past }).where(eq(invoiceEditSessions.id, sessionId)).run();
  expect(existsSync(staged.storedPath)).toBe(true);

  const result = maintainWorkspaceState(past);

  expect(result).toMatchObject({ released: 1, unlinked: 1, prunedSessions: 1 });
  expect(existsSync(staged.storedPath)).toBe(false);
  expect(db.select().from(invoiceStagedFiles).where(eq(invoiceStagedFiles.token, staged.token)).get()).toBeUndefined();
  expect(db.select().from(invoiceEditSessions).where(eq(invoiceEditSessions.id, sessionId)).get()).toBeUndefined();
  expect(db.select().from(invoiceEditGenerations).where(eq(invoiceEditGenerations.sessionId, sessionId)).all()).toEqual([]);
});

test("a live processing operation pins expired staging and its canonical session", async () => {
  const { invoice, sessionId, staged } = await stagedFixture(); const past = "2000-01-01T00:00:00.000Z"; const future = "2999-01-01T00:00:00.000Z";
  db.update(invoiceStagedFiles).set({ expiresAt: past }).where(eq(invoiceStagedFiles.token, staged.token)).run();
  db.update(invoiceEditSessions).set({ expiresAt: past }).where(eq(invoiceEditSessions.id, sessionId)).run();
  db.insert(invoiceOperations).values({ id: "pin", invoiceId: invoice.id, sessionId, kind: "save", digest: "pin", state: "processing", fencingGeneration: 1, leaseExpiresAt: future, resultJson: null, createdAt: past, updatedAt: past }).run();

  expect(maintainWorkspaceState(past)).toMatchObject({ released: 0, prunedSessions: 0 });
  expect(existsSync(staged.storedPath)).toBe(true);
  expect(db.select().from(invoiceStagedFiles).where(eq(invoiceStagedFiles.token, staged.token)).get()?.state).toBe("staged");
  expect(db.select().from(invoiceEditSessions).where(eq(invoiceEditSessions.id, sessionId)).get()).toBeDefined();
});

test("a released staging row is retried, while an uncertain path is never unlinked or removed", async () => {
  const { sessionId, staged } = await stagedFixture();
  const past = "2000-01-01T00:00:00.000Z";
  db.update(invoiceEditSessions).set({ state: "cancelled", expiresAt: past }).where(eq(invoiceEditSessions.id, sessionId)).run();
  db.update(invoiceStagedFiles).set({ state: "released" }).where(eq(invoiceStagedFiles.token, staged.token)).run();
  expect(maintainWorkspaceState(past)).toMatchObject({ released: 0, unlinked: 1, prunedSessions: 1 });
  expect(existsSync(staged.storedPath)).toBe(false);

  const unsafe = join(paths.tmpDir, "not-an-invoice-stage-file");
  writeFileSync(unsafe, "keep");
  const fixture = await stagedFixture();
  db.update(invoiceEditSessions).set({ state: "cancelled", expiresAt: past }).where(eq(invoiceEditSessions.id, fixture.sessionId)).run();
  db.update(invoiceStagedFiles).set({ state: "released", storedPath: unsafe }).where(eq(invoiceStagedFiles.token, fixture.staged.token)).run();
  expect(maintainWorkspaceState(past)).toMatchObject({ unlinked: 0, prunedSessions: 0 });
  expect(existsSync(unsafe)).toBe(true);
  expect(db.select().from(invoiceStagedFiles).where(eq(invoiceStagedFiles.token, fixture.staged.token)).get()?.state).toBe("released");
});

test("an expired operation is fenced before rejection and its terminal receipt survives session cleanup", async () => {
  const { invoice, sessionId } = await stagedFixture();
  const other = await stagedFixture();
  const past = "2000-01-01T00:00:00.000Z";
  // Remove staging first: plaintext cannot be pruned until durable staging is gone.
  db.delete(invoiceStagedFiles).where(eq(invoiceStagedFiles.sessionId, sessionId)).run();
  db.update(invoiceEditSessions).set({ expiresAt: past }).where(eq(invoiceEditSessions.id, sessionId)).run();
  db.delete(invoiceStagedFiles).where(eq(invoiceStagedFiles.sessionId, other.sessionId)).run();
  db.update(invoiceEditSessions).set({ expiresAt: past }).where(eq(invoiceEditSessions.id, other.sessionId)).run();
  // The operation identity is composite (invoiceId, id); identical ids must
  // not let the first expiry fence the other invoice's worker.
  db.insert(invoiceOperations).values([{ id: "expired", invoiceId: invoice.id, sessionId, kind: "save", digest: "first-expired", state: "processing", fencingGeneration: 7, leaseExpiresAt: past, resultJson: null, createdAt: past, updatedAt: past }, { id: "expired", invoiceId: other.invoice.id, sessionId: other.sessionId, kind: "save", digest: "second-expired", state: "processing", fencingGeneration: 4, leaseExpiresAt: past, resultJson: null, createdAt: past, updatedAt: past }]).run();
  db.insert(invoiceRebases).values({ id: "operation:expired", sessionId, digest: "expired", state: "operation-detail", fromGeneration: 1, toGeneration: null, resultJson: JSON.stringify({ conflict: { private: "lease only" } }), createdAt: past }).run();

  expect(maintainWorkspaceState(past)).toMatchObject({ expiredOperations: 2, prunedSessions: 2 });
  expect(db.select().from(invoiceEditSessions).where(eq(invoiceEditSessions.id, sessionId)).get()).toBeUndefined();
  expect(db.select().from(invoiceEditGenerations).where(eq(invoiceEditGenerations.sessionId, sessionId)).all()).toEqual([]);
  expect(db.select().from(invoiceRebases).where(eq(invoiceRebases.sessionId, sessionId)).all()).toEqual([]);
  expect(db.select().from(invoiceOperations).where(eq(invoiceOperations.id, "expired")).get()).toMatchObject({ state: "rejected", fencingGeneration: 8, leaseExpiresAt: null });
  expect(db.select().from(invoiceOperations).where(eq(invoiceOperations.invoiceId, invoice.id)).get()?.resultJson).toContain("first-expired");
  expect(db.select().from(invoiceOperations).where(eq(invoiceOperations.invoiceId, other.invoice.id)).get()).toMatchObject({ state: "rejected", fencingGeneration: 5 });
  expect(db.select().from(invoiceOperations).where(eq(invoiceOperations.invoiceId, other.invoice.id)).get()?.resultJson).toContain("second-expired");
});

test("expired committed-session plaintext is pruned even when promoted metadata remains", async () => {
  const { sessionId, staged } = await stagedFixture();
  const past = "2000-01-01T00:00:00.000Z";
  db.update(invoiceEditSessions).set({ expiresAt: past }).where(eq(invoiceEditSessions.id, sessionId)).run();
  db.update(invoiceStagedFiles).set({ state: "promoted" }).where(eq(invoiceStagedFiles.token, staged.token)).run();
  expect(maintainWorkspaceState(past)).toMatchObject({ prunedSessions: 1 });
  expect(db.select().from(invoiceEditSessions).where(eq(invoiceEditSessions.id, sessionId)).get()).toBeUndefined();
  // A promoted row was never an unlink candidate; this fixture's bytes are
  // removed by test isolation rather than maintenance.
  expect(existsSync(staged.storedPath)).toBe(true);
});
