import { beforeEach, expect, test } from "bun:test";
import { db } from "../../db/client.ts";
import { clients, invoiceItems, invoices } from "../../db/schema.ts";
import { nowIso } from "../../domain/dates.ts";
import { clientInvoiceStats } from "./invoices.repository.ts";

beforeEach(() => {
  db.delete(invoiceItems).run();
  db.delete(invoices).run();
  db.delete(clients).run();
});

test("dashboard stats sum each client's unpaid invoice items without cross-client leakage", () => {
  const now = nowIso();
  const [alpha, beta] = db.insert(clients).values([
    { name: "Alpha", code: "ALPHA", defaultCurrency: "USD", isDefault: false, partyFieldsJson: "[]", createdAt: now, updatedAt: now },
    { name: "Beta", code: "BETA", defaultCurrency: "EUR", isDefault: false, partyFieldsJson: "[]", createdAt: now, updatedAt: now },
  ]).returning().all();

  function invoice(clientId: number, number: string, status: string) {
    return db.insert(invoices).values({
      clientId, number, numberingProfileId: null, invoiceDate: "2026-09-01",
      currency: "USD", status, nfseDescription: null, notes: null,
      createdAt: now, updatedAt: now,
    }).returning().get();
  }
  function items(invoiceId: number, values: number[]) {
    db.insert(invoiceItems).values(values.map((value, position) => ({
      invoiceId, name: `Item ${position + 1}`, value, source: "other", notes: null,
      position, createdAt: now, updatedAt: now,
    }))).run();
  }

  const alphaDraft = invoice(alpha!.id, "ALPHA-DRAFT", "draft"); items(alphaDraft.id, [100, 25]);
  const alphaIssued = invoice(alpha!.id, "ALPHA-ISSUED", "issued"); items(alphaIssued.id, [40]);
  const alphaSent = invoice(alpha!.id, "ALPHA-SENT", "sent"); items(alphaSent.id, [60]);
  const alphaPaid = invoice(alpha!.id, "ALPHA-PAID", "paid"); items(alphaPaid.id, [80]);
  const alphaVoid = invoice(alpha!.id, "ALPHA-VOID", "void"); items(alphaVoid.id, [90]);
  invoice(alpha!.id, "ALPHA-EMPTY", "draft");

  const betaDraft = invoice(beta!.id, "BETA-DRAFT", "draft"); items(betaDraft.id, [700]);
  const betaIssued = invoice(beta!.id, "BETA-ISSUED", "issued"); items(betaIssued.id, [300]);
  const betaSent = invoice(beta!.id, "BETA-SENT", "sent"); items(betaSent.id, [20, 30]);
  const betaPaid = invoice(beta!.id, "BETA-PAID", "paid"); items(betaPaid.id, [999]);

  const stats = new Map(clientInvoiceStats().map((stat) => [stat.clientId, stat]));
  expect(stats.get(alpha!.id)).toEqual({ clientId: alpha!.id, invoiceCount: 6, outstandingMinor: 225 });
  expect(stats.get(beta!.id)).toEqual({ clientId: beta!.id, invoiceCount: 4, outstandingMinor: 1050 });
});
