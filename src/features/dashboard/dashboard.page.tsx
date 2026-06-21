import type { Client } from "../../db/schema.ts";
import { PageHeader } from "../../web/components/page-header.tsx";
import { formatMoney } from "../../domain/money.ts";
import { InvoicesTable } from "../invoices/components/invoices-table.tsx";
import type { InvoiceListRow } from "../invoices/invoices.repository.ts";
import type { ClientInvoiceStats } from "../invoices/invoices.repository.ts";

export type DashboardData = {
  clients: Client[];
  stats: Map<number, ClientInvoiceStats>;
  recentInvoices: InvoiceListRow[];
};

/** Cross-client overview: client workspaces plus the most recent invoices. */
export function DashboardPage({ clients, stats, recentInvoices }: DashboardData) {
  return (
    <div>
      <PageHeader
        title="Overview"
        description="Your clients and recent invoicing activity."
        actions={
          <a href="/invoices/new" class="btn btn-primary btn-sm">
            New invoice
          </a>
        }
      />

      {clients.length === 0 ? (
        <div class="app-card lift-enter rounded-lg border-dashed p-10 text-center">
          <p class="text-sm text-base-content/60">
            No clients yet. Add a client to start invoicing.
          </p>
          <a href="/clients/new" class="btn btn-primary btn-sm mt-4">
            New client
          </a>
        </div>
      ) : (
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {clients.map((client) => (
            <ClientCard client={client} stats={stats.get(client.id)} />
          ))}
        </div>
      )}

      <section class="mt-10">
        <h2 class="mb-3 text-lg font-semibold">Recent invoices</h2>
        <InvoicesTable invoices={recentInvoices} />
      </section>
    </div>
  );
}

function ClientCard({
  client,
  stats,
}: {
  client: Client;
  stats?: ClientInvoiceStats;
}) {
  const count = stats?.invoiceCount ?? 0;
  const outstanding = stats?.outstandingMinor ?? 0;
  return (
    <a
      href={`/clients/${client.id}`}
      class="app-card lift-enter block rounded-lg p-4 transition hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-xl"
    >
      <div class="flex items-center gap-2">
        <span class="font-medium">{client.name}</span>
        {client.isDefault ? (
          <span class="text-amber-400" title="Default client">
            ★
          </span>
        ) : null}
        <span class="badge badge-sm app-code-badge ml-auto font-mono">
          {client.code}
        </span>
      </div>
      <div class="mt-3 flex items-end justify-between">
        <div>
          <div class="text-xs uppercase tracking-wide text-base-content/50">
            Invoices
          </div>
          <div class="text-xl font-semibold tabular-nums">{count}</div>
        </div>
        <div class="text-right">
          <div class="text-xs uppercase tracking-wide text-base-content/50">
            Outstanding
          </div>
          <div class="text-xl font-semibold tabular-nums">
            {formatMoney(outstanding, client.defaultCurrency)}
          </div>
        </div>
      </div>
    </a>
  );
}
