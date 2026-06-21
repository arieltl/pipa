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
import {
  addItem,
  createInvoice,
  deleteItem,
  generateNfseDescription,
  getInvoiceDetail,
  InvoiceNumberRequiredError,
  InvoiceNumberTakenError,
  saveNfseDescription,
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
  test("generates a per-client monthly number and copies the fixed item", () => {
    const clientId = makeClient({ code: "LONDONCO" });
    const inv = createInvoice({
      clientId,
      invoiceDate: "2026-06-30",
      currency: "GBP",
      includeFixedMonthly: true,
      manualNumber: undefined,
      notes: undefined,
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
});

describe("createInvoice — fixed monthly item", () => {
  test("omitted when includeFixedMonthly is false", () => {
    const clientId = makeClient({ code: "NOFIX" });
    const inv = createInvoice({ ...base(clientId), includeFixedMonthly: false });
    expect(getInvoiceDetail(inv.id)!.items).toHaveLength(0);
  });

  test("omitted when the client has no default value", () => {
    const clientId = makeClient({ code: "NOVAL", defaultFixedMonthlyValue: null });
    const inv = createInvoice(base(clientId));
    expect(getInvoiceDetail(inv.id)!.items).toHaveLength(0);
  });

  test("changing the client default does not mutate existing invoices", () => {
    const clientId = makeClient({ code: "HIST", defaultFixedMonthlyValue: 400000 });
    const inv = createInvoice(base(clientId));

    db.update(clients)
      .set({ defaultFixedMonthlyValue: 999999 })
      .where(eq(clients.id, clientId))
      .run();

    expect(getInvoiceDetail(inv.id)!.items[0]!.value).toBe(400000);
  });
});

describe("item CRUD and totals", () => {
  test("add/update/delete recomputes the total", () => {
    const clientId = makeClient({ code: "ITEMS", defaultFixedMonthlyValue: null });
    const inv = createInvoice(base(clientId));

    const item = addItem(inv.id, {
      name: "Travel",
      value: "120.00",
      source: "expense",
      notes: undefined,
      currency: "GBP",
    });
    expect(getInvoiceDetail(inv.id)!.total).toBe(12000);

    updateItem(item.id, {
      name: "Travel",
      value: "150.00",
      source: "expense",
      notes: undefined,
      currency: "GBP",
    });
    expect(getInvoiceDetail(inv.id)!.total).toBe(15000);

    deleteItem(item.id);
    expect(getInvoiceDetail(inv.id)!.total).toBe(0);
  });
});

describe("templates (Phase 4)", () => {
  test("fixed monthly item name is rendered from the client template", () => {
    const clientId = makeClient({
      name: "London Co",
      code: "LONDONCO",
      defaultFixedMonthlyValue: 400000,
      defaultFixedMonthlyItemNameTemplate:
        "{{client.name}} - dev services - {{invoice.dateMonthName}} {{invoice.dateYear}}",
    });
    const inv = createInvoice(base(clientId));
    const item = getInvoiceDetail(inv.id)!.items[0]!;
    expect(item.name).toBe("London Co - dev services - June 2026");
  });

  test("item name template can use the freshly allocated invoice number", () => {
    const clientId = makeClient({
      code: "NUMTPL",
      defaultFixedMonthlyValue: 400000,
      defaultFixedMonthlyItemNameTemplate: "Services - Invoice {{invoice.number}}",
    });
    const inv = createInvoice(base(clientId));
    const item = getInvoiceDetail(inv.id)!.items[0]!;
    expect(item.name).toBe(`Services - Invoice ${inv.number}`);
  });

  test("generate renders the nota fiscal template; save persists it", () => {
    const clientId = makeClient({
      code: "NFSE",
      legalName: "London Co Ltd",
      defaultFixedMonthlyValue: null,
      defaultNfseDescriptionTemplate:
        "Serviços para {{client.legalName}} conforme invoice {{invoice.number}}, emitida em {{invoice.date}}.",
    });
    const inv = createInvoice(base(clientId));
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
    const inv = createInvoice(base(clientId));
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
    const inv = createInvoice(base(clientId));
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

function base(clientId: number) {
  return {
    clientId,
    invoiceDate: "2026-06-30",
    currency: "GBP" as const,
    includeFixedMonthly: true,
    manualNumber: undefined,
    notes: undefined,
  };
}
