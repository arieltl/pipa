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

export type NfseInitial = { value: string; autofilled: boolean };

export function InvoiceDetailBody({
  detail,
  pdfFilename,
  nfse,
}: {
  detail: InvoiceDetail;
  pdfFilename: string;
  /** Initial nota fiscal text (saved value, or auto-generated when empty). */
  nfse: NfseInitial;
}) {
  const { invoice, client, items, total, notaFiscal, archivedPdf } = detail;
  return (
    <div class="grid gap-6">
      {/* Action bar: the two most common actions, always reachable. */}
      <div class="app-card lift-enter sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg p-4">
        <div class="flex items-center gap-3">
          <span class="text-xs font-medium uppercase tracking-wide text-base-content/50">
            Status
          </span>
          <StatusControl invoice={invoice} />
        </div>
        <a href={`/invoices/${invoice.id}/pdf`} class="btn btn-primary btn-sm">
          Download PDF
        </a>
      </div>

      <div class="grid gap-6 lg:grid-cols-3">
        <div class="grid gap-6 lg:col-span-2">
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
            <div class="app-card rounded-lg p-5">
              <NfseSection
                invoiceId={invoice.id}
                value={nfse.value}
                hasTemplate={Boolean(client.defaultNfseDescriptionTemplate)}
                generated={nfse.autofilled}
              />
            </div>
          </section>

          {invoice.notes ? (
            <section>
              <h2 class="mb-3 text-lg font-semibold">Notes</h2>
              <div class="app-card rounded-lg p-5 text-sm">{invoice.notes}</div>
            </section>
          ) : null}
        </div>

        <div class="grid gap-6">
          <section>
            <h2 class="mb-3 text-lg font-semibold">Details</h2>
            <div class="app-card grid gap-4 rounded-lg p-5">
              <Meta label="Client">
                <a href={`/clients/${client.id}`} class="link link-hover">
                  {client.name}
                </a>{" "}
                <span class="badge badge-ghost badge-sm font-mono">
                  {client.code}
                </span>
              </Meta>
              <Meta label="Invoice date">
                <span class="tabular-nums">{invoice.invoiceDate}</span>
              </Meta>
              <Meta label="Currency">{invoice.currency}</Meta>
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
      </div>
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
