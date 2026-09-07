import type { Client, IssuerSettings, PdfTemplate } from "../../db/schema.ts";
import { PageHeader } from "../../web/components/page-header.tsx";
import {
  InvoiceComposer,
  type InvoiceFormValues,
} from "./components/invoice-composer.tsx";
import {
  InvoiceDetailBody,
  type NfseInitial,
} from "./components/invoice-detail.tsx";
import { InvoicesTable } from "./components/invoices-table.tsx";
import type { FieldErrors } from "../../web/components/forms.tsx";
import type { InvoiceListRow, ClientInvoiceStats } from "./invoices.repository.ts";
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

/** Quick-invoice step one: choose which client the invoice is for. */
export function PickClientPage({
  clients,
  stats,
  defaultClientId,
}: {
  clients: Client[];
  stats: Map<number, ClientInvoiceStats>;
  defaultClientId: number | null;
}) {
  return (
    <div>
      <PageHeader
        title="New invoice"
        description="Who is this invoice for?"
      />
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
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {clients.map((client) => (
            <a
              href={`/clients/${client.id}/invoices/new`}
              class="app-card lift-enter block rounded-lg p-4 transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-xl"
            >
              <div class="flex items-center gap-2">
                <span class="font-medium">{client.name}</span>
                {client.id === defaultClientId ? (
                  <span class="text-amber-400" title="Default client">
                    ★
                  </span>
                ) : null}
                <span class="badge badge-sm app-code-badge ml-auto font-mono">
                  {client.code}
                </span>
              </div>
              <div class="mt-3 text-xs text-base-content/55">
                {stats.get(client.id)?.invoiceCount ?? 0} invoice
                {(stats.get(client.id)?.invoiceCount ?? 0) === 1 ? "" : "s"} ·{" "}
                {client.defaultCurrency}
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

/** Quick-invoice step two (and the client-workspace entry): the composer. */
export function ComposeInvoicePage({
  client,
  issuer,
  values,
  currencyDefault,
  hasProfile,
  errors,
  pdfTemplates,
  templateError,
}: {
  client: Client;
  issuer: IssuerSettings | null;
  values: InvoiceFormValues;
  currencyDefault: string;
  hasProfile: boolean;
  errors?: FieldErrors;
  pdfTemplates: PdfTemplate[];
  templateError?: string;
}) {
  return (
    <div>
      <PageHeader
        title="New invoice"
        description={`For ${client.name}`}
        actions={
          <a href={`/clients/${client.id}`} class="btn btn-ghost btn-sm">
            Back to {client.name}
          </a>
        }
      />
      <div class="lift-enter mx-auto max-w-3xl">
        <InvoiceComposer
          client={client}
          issuer={issuer}
          values={values}
          currencyDefault={currencyDefault}
          hasProfile={hasProfile}
          errors={errors}
          pdfTemplates={pdfTemplates}
          templateError={templateError}
        />
      </div>
    </div>
  );
}

export function InvoiceDetailPage({
  detail,
  pdfFilename,
  nfse,
  pdfRenderBlockedReason,
}: {
  detail: InvoiceDetail;
  pdfFilename: string;
  nfse: NfseInitial;
  pdfRenderBlockedReason?: string;
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
      <InvoiceDetailBody detail={detail} pdfFilename={pdfFilename} nfse={nfse} pdfRenderBlockedReason={pdfRenderBlockedReason} />
    </div>
  );
}
