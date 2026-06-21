import type { Client } from "../../db/schema.ts";
import { PageHeader } from "../../web/components/page-header.tsx";
import { InvoiceForm, type InvoiceFormValues } from "./components/invoice-form.tsx";
import { InvoiceDetailBody } from "./components/invoice-detail.tsx";
import { InvoicesTable } from "./components/invoices-table.tsx";
import type { InvoiceListRow } from "./invoices.repository.ts";
import type { InvoiceDetail } from "./invoices.service.ts";

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
}: {
  values: InvoiceFormValues;
  clients: Client[];
}) {
  return (
    <div>
      <PageHeader title="New invoice" />
      {clients.length === 0 ? (
        <div class="rounded-lg border border-dashed border-base-300 bg-base-100 p-10 text-center">
          <p class="text-sm text-base-content/60">
            You need a client before creating an invoice.
          </p>
          <a href="/clients/new" class="btn btn-primary btn-sm mt-4">
            New client
          </a>
        </div>
      ) : (
        <div class="max-w-3xl rounded-lg border border-base-300 bg-base-100 p-6">
          <InvoiceForm values={values} clients={clients} />
        </div>
      )}
    </div>
  );
}

export function InvoiceDetailPage({
  detail,
  pdfFilename,
}: {
  detail: InvoiceDetail;
  pdfFilename: string;
}) {
  return (
    <div>
      <PageHeader
        title={detail.invoice.number}
        description={`${detail.client.name} · created ${detail.invoice.createdAt.slice(0, 10)}`}
        actions={
          <a href="/invoices" class="btn btn-ghost btn-sm">
            Back to invoices
          </a>
        }
      />
      <InvoiceDetailBody detail={detail} pdfFilename={pdfFilename} />
    </div>
  );
}
