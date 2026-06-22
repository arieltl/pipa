import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../../db/client.ts";
import {
  clients,
  invoiceItems,
  invoiceSequences,
  invoices,
} from "../../db/schema.ts";
import { nowIso } from "../../domain/dates.ts";
import { getClient } from "../clients/clients.service.ts";
import {
  addItem,
  clientSeed,
  createInvoice,
  deleteInvoice,
  deleteItem,
  DocumentLockedError,
  generateNfseDescription,
  getInvoiceDetail,
  InvoiceNumberRequiredError,
  InvoiceNumberTakenError,
  saveNfseDescription,
  updateInvoiceDoc,
  updateItem,
} from "./invoices.service.ts";

/** Insert a client directly; returns its id. Profile 1 = monthly per client. */
function makeClient(overrides: Partial<typeof clients.$inferInsert> = {}): number {
  const now = nowIso();
  const row = db
    .insert(clients)
    .values({
      name: "London Co",
      code: `C${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      defaultCurrency: "GBP",
      defaultFixedMonthlyValue: 400000,
      numberingProfileId: 1,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    })
    .returning()
    .get();
  return row.id;
}

beforeEach(() => {
  // Order matters for FKs: items -> invoices -> sequences -> clients.
  db.delete(invoiceItems).run();
  db.delete(invoices).run();
  db.delete(invoiceSequences).run();
  db.delete(clients).run();
});

describe("createInvoice — numbering", () => {
  test("generates a per-client monthly number and stores the items", () => {
    const clientId = makeClient({ code: "LONDONCO" });
    const inv = createInvoice({
      clientId,
      invoiceDate: "2026-06-30",
      currency: "GBP",
      manualNumber: undefined,
      notes: undefined,
      items: [fixedItem()],
    });

    expect(inv.number).toBe("LONDONCO-202606-01");
    const detail = getInvoiceDetail(inv.id)!;
    expect(detail.items).toHaveLength(1);
    expect(detail.items[0]!.source).toBe("fixed_monthly");
    expect(detail.items[0]!.value).toBe(400000);
    expect(detail.total).toBe(400000);
  });

  test("increments the sequence within the same period", () => {
    const clientId = makeClient({ code: "ACME" });
    const a = createInvoice(base(clientId));
    const b = createInvoice(base(clientId));
    expect(a.number).toBe("ACME-202606-01");
    expect(b.number).toBe("ACME-202606-02");
  });

  test("sequences are independent per client", () => {
    const c1 = makeClient({ code: "AAA" });
    const c2 = makeClient({ code: "BBB" });
    createInvoice(base(c1));
    const second = createInvoice(base(c2));
    expect(second.number).toBe("BBB-202606-01");
  });

  test("monthly sequence resets across months", () => {
    const clientId = makeClient({ code: "RESET" });
    createInvoice({ ...base(clientId), invoiceDate: "2026-06-30" });
    const july = createInvoice({ ...base(clientId), invoiceDate: "2026-07-01" });
    expect(july.number).toBe("RESET-202607-01");
  });
});

describe("createInvoice — manual numbering", () => {
  test("uses a manual number and skips sequence allocation", () => {
    const clientId = makeClient({ code: "MAN", numberingProfileId: null });
    const inv = createInvoice({ ...base(clientId), manualNumber: "MAN-CUSTOM-1" });
    expect(inv.number).toBe("MAN-CUSTOM-1");
    expect(db.select().from(invoiceSequences).all()).toHaveLength(0);
  });

  test("requires a number when the client has no profile", () => {
    const clientId = makeClient({ numberingProfileId: null });
    expect(() => createInvoice(base(clientId))).toThrow(
      InvoiceNumberRequiredError,
    );
  });

  test("rejects a duplicate manual number", () => {
    const clientId = makeClient({ code: "DUP", numberingProfileId: null });
    createInvoice({ ...base(clientId), manualNumber: "DUP-1" });
    expect(() =>
      createInvoice({ ...base(clientId), manualNumber: "DUP-1" }),
    ).toThrow(InvoiceNumberTakenError);
  });

  test("uses a specific sequence and advances future numbering", () => {
    const clientId = makeClient({ code: "CATCHUP" });
    const inv = createInvoice({
      ...base(clientId),
      numberingMode: "sequence",
      sequenceOverride: 7,
      advanceSequence: true,
    });
    const next = createInvoice(base(clientId));

    expect(inv.number).toBe("CATCHUP-202606-07");
    expect(next.number).toBe("CATCHUP-202606-08");
  });

  test("specific sequence advance never moves the counter backward", () => {
    const clientId = makeClient({ code: "MAXSEQ" });
    createInvoice({
      ...base(clientId),
      numberingMode: "sequence",
      sequenceOverride: 10,
      advanceSequence: true,
    });
    const inv = createInvoice({
      ...base(clientId),
      numberingMode: "sequence",
      sequenceOverride: 5,
      advanceSequence: true,
    });
    const next = createInvoice(base(clientId));

    expect(inv.number).toBe("MAXSEQ-202606-05");
    expect(next.number).toBe("MAXSEQ-202606-11");
  });

  test("specific sequence can leave future numbering unchanged", () => {
    const clientId = makeClient({ code: "NOSKIP" });
    const inv = createInvoice({
      ...base(clientId),
      numberingMode: "sequence",
      sequenceOverride: 7,
      advanceSequence: false,
    });
    const next = createInvoice(base(clientId));

    expect(inv.number).toBe("NOSKIP-202606-07");
    expect(next.number).toBe("NOSKIP-202606-01");
  });
});

describe("createInvoice — items", () => {
  test("creates no items when none are provided", () => {
    const clientId = makeClient({ code: "NOITEMS" });
    const inv = createInvoice({ ...base(clientId), items: [] });
    expect(getInvoiceDetail(inv.id)!.items).toHaveLength(0);
  });

  test("stores multiple items and sums the total", () => {
    const clientId = makeClient({ code: "MULTI" });
    const inv = createInvoice({
      ...base(clientId),
      items: [
        fixedItem(),
        { name: "Travel", value: "120.00", source: "expense", notes: undefined },
      ],
    });
    const detail = getInvoiceDetail(inv.id)!;
    expect(detail.items).toHaveLength(2);
    expect(detail.total).toBe(412000);
  });

  test("item values are snapshots, unaffected by later client edits", () => {
    const clientId = makeClient({ code: "HIST" });
    const inv = createInvoice(base(clientId));

    db.update(clients)
      .set({ defaultFixedMonthlyValue: 999999 })
      .where(eq(clients.id, clientId))
      .run();

    expect(getInvoiceDetail(inv.id)!.items[0]!.value).toBe(400000);
  });
});

describe("clientSeed — create-form defaults", () => {
  test("seeds currency and a fixed monthly item rendered from the template", () => {
    const clientId = makeClient({
      name: "London Co",
      code: "LONDONCO",
      defaultFixedMonthlyValue: 400000,
      defaultFixedMonthlyItemNameTemplate:
        "{{client.name}} - dev services - {{invoice.dateMonthName}} {{invoice.dateYear}}",
    });
    const seed = clientSeed(getClient(clientId)!, "2026-06-30");
    expect(seed.currency).toBe("GBP");
    expect(seed.fixedMonthly).not.toBeNull();
    expect(seed.fixedMonthly!.name).toBe(
      "London Co - dev services - June 2026",
    );
    expect(seed.fixedMonthly!.value).toBe("4000.00");
    expect(seed.fixedMonthly!.source).toBe("fixed_monthly");
  });

  test("no fixed monthly item when the client has no default value", () => {
    const clientId = makeClient({ code: "NOVAL", defaultFixedMonthlyValue: null });
    const seed = clientSeed(getClient(clientId)!, "2026-06-30");
    expect(seed.fixedMonthly).toBeNull();
  });
});

describe("item CRUD and totals", () => {
  test("add/update/delete recomputes the total", () => {
    const clientId = makeClient({ code: "ITEMS", defaultFixedMonthlyValue: null });
    const inv = createInvoice({ ...base(clientId), items: [] });

    const item = addItem(inv.id, {
      name: "Travel",
      value: "120.00",
      source: "expense",
      currency: "GBP",
    });
    expect(getInvoiceDetail(inv.id)!.total).toBe(12000);

    updateItem(item.id, {
      name: "Travel",
      value: "150.00",
      source: "expense",
      currency: "GBP",
    });
    expect(getInvoiceDetail(inv.id)!.total).toBe(15000);

    deleteItem(item.id);
    expect(getInvoiceDetail(inv.id)!.total).toBe(0);
  });
});

describe("templates (Phase 4)", () => {
  test("generate renders the nota fiscal template; save persists it", () => {
    const clientId = makeClient({
      code: "NFSE",
      legalName: "London Co Ltd",
      defaultFixedMonthlyValue: null,
      defaultNfseDescriptionTemplate:
        "Serviços para {{client.legalName}} conforme invoice {{invoice.number}}, emitida em {{invoice.date}}.",
    });
    const inv = createInvoice({ ...base(clientId), items: [] });
    const detail = getInvoiceDetail(inv.id)!;

    const generated = generateNfseDescription(detail);
    expect(generated).toBe(
      `Serviços para London Co Ltd conforme invoice ${inv.number}, emitida em 30/06/2026.`,
    );

    saveNfseDescription(inv.id, generated);
    expect(getInvoiceDetail(inv.id)!.invoice.nfseDescription).toBe(generated);
  });

  test("saving blank clears the nota fiscal description", () => {
    const clientId = makeClient({ code: "CLR", defaultFixedMonthlyValue: null });
    const inv = createInvoice({ ...base(clientId), items: [] });
    saveNfseDescription(inv.id, "something");
    saveNfseDescription(inv.id, "   ");
    expect(getInvoiceDetail(inv.id)!.invoice.nfseDescription).toBeNull();
  });

  test("saved nota fiscal text is not mutated by later client template edits", () => {
    const clientId = makeClient({
      code: "SNAP",
      defaultFixedMonthlyValue: null,
      defaultNfseDescriptionTemplate: "Original {{invoice.number}}",
    });
    const inv = createInvoice({ ...base(clientId), items: [] });
    saveNfseDescription(inv.id, generateNfseDescription(getInvoiceDetail(inv.id)!));

    db.update(clients)
      .set({ defaultNfseDescriptionTemplate: "Changed {{invoice.number}}" })
      .where(eq(clients.id, clientId))
      .run();

    expect(getInvoiceDetail(inv.id)!.invoice.nfseDescription).toBe(
      `Original ${inv.number}`,
    );
  });
});

describe("updateInvoiceDoc — edit draft number/date", () => {
  test("updates the number and date of a draft", () => {
    const clientId = makeClient({ code: "EDIT", numberingProfileId: null });
    const inv = createInvoice({ ...base(clientId), manualNumber: "EDIT-1" });

    const updated = updateInvoiceDoc(inv.id, {
      number: "EDIT-2",
      invoiceDate: "2026-07-15",
    });

    expect(updated.number).toBe("EDIT-2");
    expect(updated.invoiceDate).toBe("2026-07-15");
  });

  test("rejects a number already used by another invoice", () => {
    const clientId = makeClient({ code: "COLL", numberingProfileId: null });
    createInvoice({ ...base(clientId), manualNumber: "COLL-1" });
    const second = createInvoice({ ...base(clientId), manualNumber: "COLL-2" });

    expect(() =>
      updateInvoiceDoc(second.id, {
        number: "COLL-1",
        invoiceDate: "2026-06-30",
      }),
    ).toThrow(InvoiceNumberTakenError);
  });

  test("keeping the same number is allowed (no self-collision)", () => {
    const clientId = makeClient({ code: "SAME", numberingProfileId: null });
    const inv = createInvoice({ ...base(clientId), manualNumber: "SAME-1" });

    const updated = updateInvoiceDoc(inv.id, {
      number: "SAME-1",
      invoiceDate: "2026-08-01",
    });
    expect(updated.invoiceDate).toBe("2026-08-01");
  });

  test("refuses to edit a non-draft invoice", () => {
    const clientId = makeClient({ code: "LOCK" });
    const inv = createInvoice(base(clientId));
    markIssued(inv.id);

    expect(() =>
      updateInvoiceDoc(inv.id, {
        number: "LOCK-X",
        invoiceDate: "2026-06-30",
      }),
    ).toThrow(DocumentLockedError);
  });
});

describe("deleteInvoice — delete draft", () => {
  test("deletes a draft and its line items", () => {
    const clientId = makeClient({ code: "DEL", numberingProfileId: null });
    const inv = createInvoice({ ...base(clientId), manualNumber: "DEL-1" });

    deleteInvoice(inv.id);

    expect(getInvoiceDetail(inv.id)).toBeNull();
    expect(
      db.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, inv.id)).all(),
    ).toHaveLength(0);
  });

  test("refuses to delete a non-draft invoice", () => {
    const clientId = makeClient({ code: "KEEP" });
    const inv = createInvoice(base(clientId));
    markIssued(inv.id);

    expect(() => deleteInvoice(inv.id)).toThrow(DocumentLockedError);
    expect(getInvoiceDetail(inv.id)).not.toBeNull();
  });
});

/** Flip an invoice to `issued` directly, skipping the PDF-archive side effect. */
function markIssued(id: number) {
  db.update(invoices)
    .set({ status: "issued" })
    .where(eq(invoices.id, id))
    .run();
}

/** A fixed monthly item draft worth 400000 minor units (GBP 4000.00). */
function fixedItem() {
  return {
    name: "Monthly software development services",
    value: "4000.00",
    source: "fixed_monthly" as const,
    notes: undefined,
  };
}

function base(clientId: number) {
  return {
    clientId,
    invoiceDate: "2026-06-30",
    currency: "GBP" as const,
    manualNumber: undefined,
    notes: undefined,
    items: [fixedItem()],
  };
}
