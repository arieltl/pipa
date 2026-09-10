import { beforeEach, describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { clients, invoiceItems, invoiceSequences, invoices, notaFiscalLinks } from "../../db/schema.ts";
import { addItem, changeStatus, createInvoice, deleteItem, getInvoiceDetail, linkNotaFiscal, revertToDraft, saveNotes, updateInvoiceDoc, updateItem } from "./invoices.service.ts";

beforeEach(() => {
  db.delete(notaFiscalLinks).run();
  db.delete(invoiceItems).run();
  db.delete(invoices).run();
  db.delete(invoiceSequences).run();
  db.delete(clients).run();
});

function fixture() {
  const now = "2026-09-09T00:00:00.000Z";
  const client = db.insert(clients).values({ name: "Revision client", code: `REV${crypto.randomUUID().slice(0, 8)}`, defaultCurrency: "GBP", numberingProfileId: 1, partyFieldsJson: "[]", isDefault: false, createdAt: now, updatedAt: now }).returning().get();
  const invoice = createInvoice({ clientId: client.id, invoiceDate: "2026-09-09", currency: "GBP", items: [{ name: "Initial", value: "1.00", source: "other" }] });
  return { invoice: getInvoiceDetail(invoice.id)! };
}

function revision(id: number) {
  return db.select({ revision: invoices.workspaceRevision }).from(invoices).where(eq(invoices.id, id)).get()!.revision;
}

describe("legacy invoice mutation revision fencing", () => {
  test("creation establishes its baseline without a follow-on revision", () => {
    const { invoice } = fixture();
    expect(revision(invoice.invoice.id)).toBe(0);
  });

  test("legacy document mutation advances workspace revision", () => {
    const { invoice } = fixture();
    const id = invoice.invoice.id;
    updateInvoiceDoc(id, { number: `${invoice.invoice.number}-EDIT`, invoiceDate: "2026-09-10" });
    expect(revision(id)).toBe(1);
  });

  test("legacy item mutations each advance workspace revision", () => {
    const { invoice } = fixture();
    const id = invoice.invoice.id;
    const added = addItem(id, { name: "Added", value: "2.00", source: "other", currency: "GBP" });
    expect(revision(id)).toBe(1);
    updateItem(added.id, { name: "Updated", value: "3.00", source: "other", currency: "GBP" });
    expect(revision(id)).toBe(2);
    deleteItem(added.id);
    expect(revision(id)).toBe(3);
  });

  test("legacy notes advance workspace revision", () => {
    const { invoice } = fixture();
    const id = invoice.invoice.id;
    saveNotes(id, "legacy notes");
    expect(revision(id)).toBe(1);
  });

  test("legacy NFS-e links advance workspace revision", () => {
    const { invoice } = fixture();
    const id = invoice.invoice.id;
    linkNotaFiscal(getInvoiceDetail(id)!, { nfNumber: "NF-44", notes: "legacy record" });
    expect(revision(id)).toBe(1);
  });

  test("legacy status and revert service actions advance workspace revision", () => {
    const { invoice } = fixture(); const id = invoice.invoice.id;
    // Fixture setup establishes an already-issued document; transition methods
    // themselves are the production callers under test.
    db.update(invoices).set({ status: "issued" }).where(eq(invoices.id, id)).run();
    changeStatus(id, "sent");
    expect(revision(id)).toBe(1);
    revertToDraft(id);
    expect(revision(id)).toBe(2);
  });

  test("a failed revision fence rolls back the legacy item mutation instead of leaving a partial child row", () => {
    const { invoice } = fixture();
    const id = invoice.invoice.id;
    const before = db.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, id)).all();
    db.run(sql.raw("CREATE TRIGGER abort_legacy_revision BEFORE UPDATE OF workspace_revision ON invoices BEGIN SELECT RAISE(ABORT, 'revision fence failed'); END;"));
    try {
      expect(() => addItem(id, { name: "Must roll back", value: "2.00", source: "other", currency: "GBP" })).toThrow("revision fence failed");
      expect(db.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, id)).all()).toEqual(before);
      expect(revision(id)).toBe(0);
    } finally {
      db.run(sql.raw("DROP TRIGGER IF EXISTS abort_legacy_revision"));
    }
  });
});
