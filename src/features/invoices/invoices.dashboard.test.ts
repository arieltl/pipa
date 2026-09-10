import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { Window } from "happy-dom";
import { createApp } from "../../app.tsx";
import { db } from "../../db/client.ts";
import { clients, invoiceItems, invoices } from "../../db/schema.ts";
import { nowIso } from "../../domain/dates.ts";
import { outstandingTotalsForInvoices } from "../../domain/outstanding-totals.ts";
import { clientInvoiceStats } from "./invoices.repository.ts";
import { listInvoicesByClient } from "./invoices.service.ts";

beforeEach(() => {
  db.delete(invoiceItems).run();
  db.delete(invoices).run();
  db.delete(clients).run();
});

test("dashboard and client summaries keep outstanding currencies separate", async () => {
  const now = nowIso();
  const [alpha, beta, zeroItem, settled] = db.insert(clients).values([
    { name: "Alpha", code: "ALPHA", defaultCurrency: "GBP", isDefault: false, partyFieldsJson: "[]", createdAt: now, updatedAt: now },
    { name: "Beta", code: "BETA", defaultCurrency: "EUR", isDefault: false, partyFieldsJson: "[]", createdAt: now, updatedAt: now },
    { name: "Zero item", code: "ZERO", defaultCurrency: "USD", isDefault: false, partyFieldsJson: "[]", createdAt: now, updatedAt: now },
    { name: "Settled", code: "SETTLED", defaultCurrency: "USD", isDefault: false, partyFieldsJson: "[]", createdAt: now, updatedAt: now },
  ]).returning().all();

  function invoice(clientId: number, number: string, status: string, currency = "USD") {
    return db.insert(invoices).values({
      clientId, number, numberingProfileId: null, invoiceDate: "2026-09-01",
      currency, status, nfseDescription: null, notes: null,
      createdAt: now, updatedAt: now,
    }).returning().get();
  }
  function items(invoiceId: number, values: number[]) {
    db.insert(invoiceItems).values(values.map((value, position) => ({
      invoiceId, name: `Item ${position + 1}`, value, source: "other", notes: null,
      position, createdAt: now, updatedAt: now,
    }))).run();
  }

  const alphaDraft = invoice(alpha!.id, "ALPHA-DRAFT", "draft"); items(alphaDraft.id, [6000, 4000]);
  const alphaIssued = invoice(alpha!.id, "ALPHA-ISSUED", "issued"); items(alphaIssued.id, [20000]);
  const alphaSent = invoice(alpha!.id, "ALPHA-SENT", "sent"); items(alphaSent.id, [30000]);
  const alphaPaid = invoice(alpha!.id, "ALPHA-PAID", "paid"); items(alphaPaid.id, [40000]);
  const alphaVoid = invoice(alpha!.id, "ALPHA-VOID", "void"); items(alphaVoid.id, [50000]);
  const alphaEurDraft = invoice(alpha!.id, "ALPHA-EUR-DRAFT", "draft", "EUR"); items(alphaEurDraft.id, [5000]);
  const betaDraft = invoice(beta!.id, "BETA-DRAFT", "draft"); items(betaDraft.id, [7700]);
  invoice(zeroItem!.id, "ZERO-DRAFT", "draft");
  const settledPaid = invoice(settled!.id, "SETTLED-PAID", "paid"); items(settledPaid.id, [12300]);

  const stats = new Map(clientInvoiceStats().map((stat) => [stat.clientId, stat]));
  expect(stats.get(alpha!.id)).toEqual({ clientId: alpha!.id, invoiceCount: 6, outstandingByCurrency: [
    { currency: "EUR", totalMinor: 5000 },
    { currency: "USD", totalMinor: 60000 },
  ] });
  expect(stats.get(beta!.id)).toEqual({ clientId: beta!.id, invoiceCount: 1, outstandingByCurrency: [
    { currency: "USD", totalMinor: 7700 },
  ] });
  expect(stats.get(zeroItem!.id)).toEqual({ clientId: zeroItem!.id, invoiceCount: 1, outstandingByCurrency: [
    { currency: "USD", totalMinor: 0 },
  ] });
  expect(stats.get(settled!.id)).toEqual({ clientId: settled!.id, invoiceCount: 1, outstandingByCurrency: [] });
  expect(outstandingTotalsForInvoices(listInvoicesByClient(alpha!.id))).toEqual(stats.get(alpha!.id)!.outstandingByCurrency);

  const app = createApp();
  async function documentFor(path: string) {
    const response = await app.request(path);
    expect(response.status).toBe(200);
    const html = await response.text();
    const document = new Window().document;
    document.write(html);
    document.close();
    return document;
  }

  async function dashboardSummary(clientId: number) {
    const document = await documentFor("/");
    const card = document.querySelector(`a.app-card[href="/clients/${clientId}"]`);
    expect(card).not.toBeNull();
    const summary = card!.querySelector("[data-outstanding-totals]");
    expect(summary).not.toBeNull();
    return summary!.textContent;
  }

  async function workspaceSummary(clientId: number) {
    const document = await documentFor(`/clients/${clientId}`);
    const summary = document.querySelector("[data-outstanding-totals]");
    expect(summary).not.toBeNull();
    return summary!.textContent;
  }

  async function expectRenderedSummaries(
    clientId: number,
    expected: string,
    excluded?: string,
  ) {
    for (const summary of [
      await dashboardSummary(clientId),
      await workspaceSummary(clientId),
    ]) {
      expect(summary).toBe(expected);
      if (excluded) expect(summary).not.toContain(excluded);
    }
  }
  await expectRenderedSummaries(alpha!.id, "€50.00US$600.00", "£");
  await expectRenderedSummaries(beta!.id, "US$77.00", "€");
  await expectRenderedSummaries(zeroItem!.id, "US$0.00");
  await expectRenderedSummaries(settled!.id, "US$0.00");

  db.update(invoices).set({ status: "paid" }).where(eq(invoices.id, alphaSent.id)).run();
  items(alphaDraft.id, [2000]);

  const updated = new Map(clientInvoiceStats().map((stat) => [stat.clientId, stat]));
  expect(updated.get(alpha!.id)).toEqual({ clientId: alpha!.id, invoiceCount: 6, outstandingByCurrency: [
    { currency: "EUR", totalMinor: 5000 },
    { currency: "USD", totalMinor: 32000 },
  ] });
  expect(updated.get(beta!.id)).toEqual(stats.get(beta!.id));
  expect(outstandingTotalsForInvoices(listInvoicesByClient(alpha!.id))).toEqual(updated.get(alpha!.id)!.outstandingByCurrency);
  await expectRenderedSummaries(alpha!.id, "€50.00US$320.00", "£");
});
