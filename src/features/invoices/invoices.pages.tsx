import type { Client } from "../../db/schema.ts";
import { PageHeader } from "../../web/components/page-header.tsx";
import { InvoiceForm, type InvoiceFormValues } from "./components/invoice-form.tsx";
import {
  InvoiceDetailBody,
  type NfseInitial,
} from "./components/invoice-detail.tsx";
import { InvoicesTable } from "./components/invoices-table.tsx";
import type { InvoiceListRow } from "./invoices.repository.ts";
import type { ClientSeed, InvoiceDetail } from "./invoices.service.ts";

export function InvoicesListPage({ invoices }: { invoices: InvoiceListRow[] }) {
  return (
    <div>
      <PageHeader
        title="Invoices"
        description="Commercial invoices for your clients."
        actions={
          <a href="/invoices/new" class="btn btn-primary btn-sm">
            New invoice
          </a>
        }
      />
      <InvoicesTable invoices={invoices} />
    </div>
  );
}

export function NewInvoicePage({
  values,
  clients,
  seedMap,
}: {
  values: InvoiceFormValues;
  clients: Client[];
  seedMap: Record<string, ClientSeed>;
}) {
  return (
    <div>
      <PageHeader title="New invoice" />
      {clients.length === 0 ? (
        <div class="app-card lift-enter rounded-lg border-dashed p-10 text-center">
          <p class="text-sm text-base-content/60">
            You need a client before creating an invoice.
          </p>
          <a href="/clients/new" class="btn btn-primary btn-sm mt-4">
            New client
          </a>
        </div>
      ) : (
        <div class="app-card lift-enter max-w-3xl rounded-lg p-6">
          <InvoiceForm values={values} clients={clients} seedMap={seedMap} />
        </div>
      )}
    </div>
  );
}

export function InvoiceDetailPage({
  detail,
  pdfFilename,
  nfse,
}: {
  detail: InvoiceDetail;
  pdfFilename: string;
  nfse: NfseInitial;
}) {
  return (
    <div>
      <PageHeader
        title={detail.invoice.number}
        description={`${detail.client.name} · created ${detail.invoice.createdAt.slice(0, 10)}`}
        actions={
          <a href={`/clients/${detail.client.id}`} class="btn btn-ghost btn-sm">
            Back to {detail.client.name}
          </a>
        }
      />
      <InvoiceDetailBody detail={detail} pdfFilename={pdfFilename} nfse={nfse} />
    </div>
  );
}
