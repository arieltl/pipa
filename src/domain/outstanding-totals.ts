import { isOutstandingInvoice } from "./invoice-status.ts";

export type OutstandingTotal = {
  currency: string;
  totalMinor: number;
};

type InvoiceTotal = {
  currency: string;
  status: string;
  total: number;
};

/** Groups collectible invoice totals without converting their currencies. */
export function outstandingTotalsForInvoices(
  invoices: InvoiceTotal[],
): OutstandingTotal[] {
  const totals = new Map<string, number>();
  for (const invoice of invoices) {
    if (!isOutstandingInvoice(invoice.status)) continue;
    totals.set(invoice.currency, (totals.get(invoice.currency) ?? 0) + invoice.total);
  }
  return [...totals]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, totalMinor]) => ({ currency, totalMinor }));
}
