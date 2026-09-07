import type { Client, ClientInvoiceRecordType, ClientTextGenerator, NumberingProfile, PdfTemplate } from "../../db/schema.ts";
import { PageHeader } from "../../web/components/page-header.tsx";
import { formatMoney } from "../../domain/money.ts";
import { InvoicesTable } from "../invoices/components/invoices-table.tsx";
import type { InvoiceListRow } from "../invoices/invoices.repository.ts";
import {
  ClientForm,
  type ClientFormValues,
} from "./components/client-form.tsx";
import { ClientsTable } from "./components/clients-table.tsx";
import { ClientSequenceCard } from "../numbering/components/client-sequence-card.tsx";
import type { NumberingPreview } from "../numbering/numbering.service.ts";
import { TextGeneratorsSection } from "../text-generators/components/text-generators-section.tsx";
import { RecordTypesSection } from "../invoice-records/components/record-types-section.tsx";

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
              href={`/clients/${client.id}/invoices/new`}
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
  pdfTemplates,
}: {
  values: ClientFormValues;
  profiles: NumberingProfile[];
  pdfTemplates: PdfTemplate[];
}) {
  return (
    <div>
      <PageHeader title="New client" />
      <div x-data="{ workspace: 'overview' }" class="client-workspace">
      <ClientSettingsNavigation />
      <div class="min-w-0">
      {[
        ["text", "Text generators", "Create reusable text for this client: invoice emails, payment references, or NFS-e descriptions. Generate it from invoice details, then edit and copy the result."],
        ["records", "Supporting records", "Choose the information and attachments you want to collect on invoices, such as purchase orders, timesheets, or NFS-e documents."],
      ].map(([key, title, description]) => <section x-show={`workspace === '${key}'`} x-cloak class="app-card mb-5 rounded-xl p-6">
        <span class="text-xs font-medium text-primary">Available after creating this client</span>
        <h2 class="mt-2 text-xl font-semibold">{title}</h2>
        <p class="mt-3 text-sm text-base-content/65">{description}</p>
        <p class="mt-3 text-sm text-base-content/50">Enter a name and code in Overview, then create the client to continue straight to this section. Your entered details are kept when switching sections.</p>
        <button type="submit" form="client-details-form" class="btn btn-primary btn-sm mt-4">Create client to configure</button>
      </section>)}
      <ClientForm
          action="/clients"
          values={values}
          profiles={profiles}
          pdfTemplates={pdfTemplates}
          submitLabel="Create client"
      />
      </div></div>
    </div>
  );
}

export function EditClientPage({
  client,
  values,
  profiles,
  numberingPreview,
  sequenceDate,
  textGenerators,
  recordTypes,
  pdfTemplates,
}: {
  client: Client;
  values: ClientFormValues;
  profiles: NumberingProfile[];
  numberingPreview: NumberingPreview | null;
  sequenceDate: string;
  textGenerators: ClientTextGenerator[];
  recordTypes: ClientInvoiceRecordType[];
  pdfTemplates: PdfTemplate[];
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
      <div x-data="{ workspace: ['details', 'billing', 'pdf', 'text', 'records', 'numbering'].includes(new URLSearchParams(location.search).get('section')) ? new URLSearchParams(location.search).get('section') : 'overview' }" class="client-workspace">
      <ClientSettingsNavigation />
      <div class="min-w-0">
      <ClientForm
          action={`/clients/${client.id}`}
          values={values}
          profiles={profiles}
          pdfTemplates={pdfTemplates}
          submitLabel="Save changes"
      />
      <div x-show="workspace === 'text'" x-cloak><TextGeneratorsSection clientId={client.id} generators={textGenerators} /></div>
      <div x-show="workspace === 'records'" x-cloak><RecordTypesSection clientId={client.id} recordTypes={recordTypes} /></div>
      <div x-show="workspace === 'numbering'" x-cloak>
        <ClientSequenceCard
          client={client}
          preview={numberingPreview}
          invoiceDate={sequenceDate}
        />
      </div>
      </div></div>
    </div>
  );
}

function ClientSettingsNavigation() {
  return <nav class="client-workspace-nav" aria-label="Client settings">
    {[["overview", "Overview"], ["details", "Document details"], ["billing", "Billing"], ["numbering", "Numbering"], ["pdf", "PDF appearance"], ["text", "Text generators"], ["records", "Supporting records"]].map(([key, label]) => <button type="button" x-on:click={`workspace = '${key}'`} x-bind:aria-current={`workspace === '${key}' ? 'page' : null`}>{label}</button>)}
  </nav>;
}
