import { formatMoney } from "../../../domain/money.ts";
import {
  StatusBadge,
  type InvoiceStatus,
} from "../../../web/components/status-badge.tsx";
import type { InvoiceListRow } from "../invoices.repository.ts";

export function InvoicesTable({ invoices }: { invoices: InvoiceListRow[] }) {
  if (invoices.length === 0) {
    return (
      <div class="app-card lift-enter rounded-lg border-dashed p-10 text-center">
        <p class="text-sm text-base-content/60">
          No invoices yet. Create your first invoice to get started.
        </p>
        <a href="/invoices/new" class="btn btn-primary btn-sm mt-4">
          New invoice
        </a>
      </div>
    );
  }

  return (
    <div class="app-table lift-enter overflow-x-auto rounded-lg">
      <table class="table">
        <thead>
          <tr>
            <th>Number</th>
            <th>Client</th>
            <th>Date</th>
            <th>Status</th>
            <th class="text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv) => (
            <tr class="hover">
              <td>
                <a
                  href={`/invoices/${inv.id}`}
                  class="link link-hover font-mono font-medium"
                >
                  {inv.number}
                </a>
              </td>
              <td>{inv.clientName}</td>
              <td class="tabular-nums text-base-content/84">{inv.invoiceDate}</td>
              <td>
                <StatusBadge status={inv.status as InvoiceStatus} />
              </td>
              <td class="text-right tabular-nums">
                {formatMoney(inv.total, inv.currency)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
