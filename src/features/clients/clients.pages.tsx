import type { Client, NumberingProfile } from "../../db/schema.ts";
import { PageHeader } from "../../web/components/page-header.tsx";
import { formatMoney } from "../../domain/money.ts";
import { InvoicesTable } from "../invoices/components/invoices-table.tsx";
import type { InvoiceListRow } from "../invoices/invoices.repository.ts";
import {
  ClientForm,
  type ClientFormValues,
} from "./components/client-form.tsx";
import { ClientsTable } from "./components/clients-table.tsx";

export function ClientsListPage({ clients }: { clients: Client[] }) {
  return (
    <div>
      <PageHeader
        title="Clients"
        description="Companies you invoice. Defaults here seed new invoices but never change historical ones."
        actions={
          <a href="/clients/new" class="btn btn-primary btn-sm">
            New client
          </a>
        }
      />
      <ClientsTable clients={clients} />
    </div>
  );
}

export function ClientWorkspacePage({
  client,
  invoices,
}: {
  client: Client;
  invoices: InvoiceListRow[];
}) {
  const outstanding = invoices
    .filter((inv) => inv.status === "draft" || inv.status === "sent")
    .reduce((acc, inv) => acc + inv.total, 0);

  return (
    <div>
      <PageHeader
        title={client.name}
        description={`Client ${client.code}`}
        actions={
          <>
            <a
              href={`/clients/${client.id}/edit`}
              class="btn btn-ghost btn-sm"
            >
              Client settings
            </a>
            <a
              href={`/invoices/new?clientId=${client.id}`}
              class="btn btn-primary btn-sm"
            >
              New invoice
            </a>
          </>
        }
      />

      <div class="mb-6 grid gap-4 sm:grid-cols-3">
        <SummaryCard label="Invoices" value={String(invoices.length)} />
        <SummaryCard
          label="Outstanding"
          value={formatMoney(outstanding, client.defaultCurrency)}
        />
        <SummaryCard
          label="Default currency"
          value={client.defaultCurrency}
          badge={client.isDefault ? "★ Default client" : undefined}
        />
      </div>

      <InvoicesTable invoices={invoices} />
    </div>
  );
}

function SummaryCard({
  label,
  value,
  badge,
}: {
  label: string;
  value: string;
  badge?: string;
}) {
  return (
    <div class="app-card lift-enter rounded-lg p-4">
      <div class="flex items-center justify-between">
        <div class="text-xs font-medium uppercase tracking-wide text-base-content/50">
          {label}
        </div>
        {badge ? (
          <span class="text-xs font-medium text-amber-500">{badge}</span>
        ) : null}
      </div>
      <div class="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

export function NewClientPage({
  values,
  profiles,
}: {
  values: ClientFormValues;
  profiles: NumberingProfile[];
}) {
  return (
    <div>
      <PageHeader title="New client" />
      <div class="app-card lift-enter max-w-3xl rounded-lg p-6">
        <ClientForm
          action="/clients"
          values={values}
          profiles={profiles}
          submitLabel="Create client"
        />
      </div>
    </div>
  );
}

export function EditClientPage({
  client,
  values,
  profiles,
}: {
  client: Client;
  values: ClientFormValues;
  profiles: NumberingProfile[];
}) {
  return (
    <div>
      <PageHeader
        title={client.name}
        description={`Client ${client.code}`}
        actions={
          <a href={`/clients/${client.id}`} class="btn btn-ghost btn-sm">
            Back to workspace
          </a>
        }
      />
      <div class="app-card lift-enter max-w-3xl rounded-lg p-6">
        <ClientForm
          action={`/clients/${client.id}`}
          values={values}
          profiles={profiles}
          submitLabel="Save changes"
        />
      </div>
    </div>
  );
}
