import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "../../db/client.ts";
import { eq } from "drizzle-orm";
import {
  clients,
  files,
  invoiceItems,
  invoiceSequences,
  invoices,
  notaFiscalLinks,
} from "../../db/schema.ts";
import { nowIso } from "../../domain/dates.ts";
import {
  canManuallyTransition,
  isDocumentEditable,
  manualStatusOptions,
} from "../../domain/invoice-status.ts";
import {
  addItem,
  changeStatus,
  createInvoice,
  deleteItem,
  DocumentLockedError,
  EmptyInvoiceError,
  getInvoiceDetail,
  InvalidStatusTransitionError,
  issueInvoice,
  markSent,
  revertToDraft,
  saveNotes,
  updateItem,
} from "./invoices.service.ts";

function makeClient(): number {
  const now = nowIso();
  return db
    .insert(clients)
    .values({
      name: "London Co",
      code: `C${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      defaultCurrency: "GBP",
      defaultFixedMonthlyValue: 400000,
      numberingProfileId: 1,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get().id;
}

function newInvoice(withItems = true) {
  const clientId = makeClient();
  const inv = createInvoice({
    clientId,
    invoiceDate: "2026-06-30",
    currency: "GBP",
    manualNumber: undefined,
    notes: undefined,
    items: withItems
      ? [{ name: "Services", value: "4000.00", source: "fixed_monthly", notes: undefined }]
      : [],
  });
  return getInvoiceDetail(inv.id)!;
}

const item = (value = "10.00") => ({
  name: "Extra",
  value,
  source: "other" as const,
  notes: undefined,
  currency: "GBP" as const,
});

beforeEach(() => {
  db.delete(notaFiscalLinks).run();
  db.delete(invoiceItems).run();
  db.delete(invoices).run();
  db.delete(invoiceSequences).run();
  db.delete(clients).run();
  db.delete(files).run();
});

describe("invoice-status domain", () => {
  test("only draft is document-editable", () => {
    expect(isDocumentEditable("draft")).toBe(true);
    for (const s of ["issued", "sent", "paid", "void"]) {
      expect(isDocumentEditable(s)).toBe(false);
    }
  });

  test("draft<->issued barrier is excluded from manual transitions", () => {
    expect(canManuallyTransition("draft", "issued")).toBe(false);
    expect(canManuallyTransition("issued", "draft")).toBe(false);
    expect(canManuallyTransition("issued", "sent")).toBe(true);
    expect(canManuallyTransition("void", "paid")).toBe(true);
  });

  test("manual options exclude draft and the current value's no-op", () => {
    expect(manualStatusOptions("draft")).toEqual([]);
    expect(manualStatusOptions("issued")).toEqual(["issued", "sent", "paid", "void"]);
  });
});

describe("issueInvoice", () => {
  test("archives the PDF and moves draft to issued", async () => {
    const detail = newInvoice();
    const updated = await issueInvoice(detail);
    expect(updated.status).toBe("issued");
    expect(getInvoiceDetail(detail.invoice.id)!.invoice.archivedPdfFileId).not.toBeNull();
  });

  test("refuses to issue an empty invoice", async () => {
    const detail = newInvoice(false);
    expect(issueInvoice(detail)).rejects.toBeInstanceOf(EmptyInvoiceError);
    expect(getInvoiceDetail(detail.invoice.id)!.invoice.status).toBe("draft");
  });

  test("refuses to issue a non-draft invoice", async () => {
    const detail = newInvoice();
    await issueInvoice(detail);
    const reloaded = getInvoiceDetail(detail.invoice.id)!;
    expect(issueInvoice(reloaded)).rejects.toBeInstanceOf(InvalidStatusTransitionError);
  });

  test("does not issue an obsolete detail after its workspace revision changed", async () => {
    const detail = newInvoice();
    db.update(invoices).set({ workspaceRevision: detail.invoice.workspaceRevision + 1, updatedAt: nowIso() }).where(eq(invoices.id, detail.invoice.id)).run();
    await expect(issueInvoice(detail)).rejects.toMatchObject({ code: "STALE_REVISION" });
    const current = getInvoiceDetail(detail.invoice.id)!;
    expect(current.invoice.status).toBe("draft");
    expect(current.invoice.archivedPdfFileId).toBeNull();
  });
});

describe("document lock", () => {
  test("items cannot be added/edited/deleted once issued", async () => {
    const detail = newInvoice();
    const itemId = detail.items[0]!.id;
    await issueInvoice(detail);

    expect(() => addItem(detail.invoice.id, item())).toThrow(DocumentLockedError);
    expect(() => updateItem(itemId, item("99.00"))).toThrow(DocumentLockedError);
    expect(() => deleteItem(itemId)).toThrow(DocumentLockedError);
  });

  test("reverting to draft unlocks editing", async () => {
    const detail = newInvoice();
    await issueInvoice(detail);
    revertToDraft(detail.invoice.id);

    expect(getInvoiceDetail(detail.invoice.id)!.invoice.status).toBe("draft");
    const added = addItem(detail.invoice.id, item());
    expect(added.id).toBeGreaterThan(0);
  });

  test("revert keeps the archived PDF", async () => {
    const detail = newInvoice();
    await issueInvoice(detail);
    const archived = getInvoiceDetail(detail.invoice.id)!.invoice.archivedPdfFileId;
    revertToDraft(detail.invoice.id);
    expect(getInvoiceDetail(detail.invoice.id)!.invoice.archivedPdfFileId).toBe(archived!);
  });

  test("revert refuses a draft invoice", () => {
    const detail = newInvoice();
    expect(() => revertToDraft(detail.invoice.id)).toThrow(InvalidStatusTransitionError);
  });
});

describe("changeStatus", () => {
  test("allows moves within the loose cluster", async () => {
    const detail = newInvoice();
    await issueInvoice(detail);
    expect(changeStatus(detail.invoice.id, "sent").status).toBe("sent");
    expect(changeStatus(detail.invoice.id, "paid").status).toBe("paid");
    expect(changeStatus(detail.invoice.id, "void").status).toBe("void");
  });

  test("rejects crossing the draft barrier", async () => {
    const detail = newInvoice();
    expect(() => changeStatus(detail.invoice.id, "sent")).toThrow(
      InvalidStatusTransitionError,
    );
    await issueInvoice(detail);
    expect(() => changeStatus(detail.invoice.id, "draft")).toThrow(
      InvalidStatusTransitionError,
    );
  });
});

describe("notes + markSent", () => {
  test("saveNotes persists and clears", () => {
    const detail = newInvoice();
    expect(saveNotes(detail.invoice.id, "  hi  ").notes).toBe("hi");
    expect(saveNotes(detail.invoice.id, "   ").notes).toBeNull();
  });

  test("markSent sets the status to sent", async () => {
    const detail = newInvoice();
    await issueInvoice(detail);
    expect(markSent(detail.invoice.id).status).toBe("sent");
  });
});
