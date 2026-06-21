import type { Client, Invoice } from "../../../db/schema.ts";
import {
  StatusBadge,
  type InvoiceStatus,
} from "../../../web/components/status-badge.tsx";
import { ItemsSection } from "./items-section.tsx";
import { NfseSection } from "./nfse-section.tsx";
import { NfseLinkSection } from "./nfse-link-section.tsx";
import { PdfSection } from "./pdf-section.tsx";
import { emptyItemFormValues } from "../invoices.view.ts";
import type { InvoiceDetail } from "../invoices.service.ts";

const STATUSES: InvoiceStatus[] = ["draft", "sent", "paid", "void"];

/** Status badge + change control; swapped on its own via `#invoice-status`. */
export function StatusControl({ invoice }: { invoice: Invoice }) {
  return (
    <div id="invoice-status" class="flex items-center gap-2">
      <StatusBadge status={invoice.status as InvoiceStatus} />
      <select
        name="status"
        class="select select-bordered select-xs"
        hx-post={`/invoices/${invoice.id}/status`}
        hx-trigger="change"
        hx-target="#invoice-status"
        hx-swap="outerHTML"
      >
        {STATUSES.map((s) => (
          <option value={s} selected={invoice.status === s}>
            {s}
          </option>
        ))}
      </select>
    </div>
  );
}

export function InvoiceDetailBody({
  detail,
  pdfFilename,
}: {
  detail: InvoiceDetail;
  pdfFilename: string;
}) {
  const { invoice, client, items, total, notaFiscal, archivedPdf } = detail;
  return (
    <div class="grid gap-6">
      <div class="grid gap-4 rounded-lg border border-base-300 bg-base-100 p-5 sm:grid-cols-2">
        <Meta label="Client">
          <a href={`/clients/${client.id}`} class="link link-hover">
            {client.name}
          </a>{" "}
          <span class="badge badge-ghost badge-sm font-mono">{client.code}</span>
        </Meta>
        <Meta label="Status">
          <StatusControl invoice={invoice} />
        </Meta>
        <Meta label="Invoice date">
          <span class="tabular-nums">{invoice.invoiceDate}</span>
        </Meta>
        <Meta label="Currency">{invoice.currency}</Meta>
        {invoice.notes ? (
          <div class="sm:col-span-2">
            <Meta label="Notes">{invoice.notes}</Meta>
          </div>
        ) : null}
      </div>

      <section>
        <h2 class="mb-3 text-lg font-semibold">Items</h2>
        <ItemsSection
          invoiceId={invoice.id}
          currency={invoice.currency}
          items={items}
          total={total}
          addValues={emptyItemFormValues()}
        />
      </section>

      <section>
        <h2 class="mb-3 text-lg font-semibold">Nota fiscal description</h2>
        <div class="rounded-lg border border-base-300 bg-base-100 p-5">
          <NfseSection
            invoiceId={invoice.id}
            value={invoice.nfseDescription ?? ""}
            hasTemplate={Boolean(client.defaultNfseDescriptionTemplate)}
          />
        </div>
      </section>

      <section>
        <h2 class="mb-3 text-lg font-semibold">Invoice PDF</h2>
        <PdfSection
          invoice={invoice}
          archivedPdf={archivedPdf}
          filename={pdfFilename}
        />
      </section>

      <section>
        <h2 class="mb-3 text-lg font-semibold">Nota fiscal / NFS-e link</h2>
        <NfseLinkSection invoiceId={invoice.id} link={notaFiscal} />
      </section>
    </div>
  );
}

function Meta({ label, children }: { label: string; children: unknown }) {
  return (
    <div>
      <div class="text-xs font-medium uppercase tracking-wide text-base-content/50">
        {label}
      </div>
      <div class="mt-1">{children as never}</div>
    </div>
  );
}
