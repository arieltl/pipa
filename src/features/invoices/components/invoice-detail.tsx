import type { FileRecord, Invoice } from "../../../db/schema.ts";
import {
  StatusBadge,
  type InvoiceStatus,
} from "../../../web/components/status-badge.tsx";
import {
  isDocumentEditable,
  manualStatusOptions,
} from "../../../domain/invoice-status.ts";
import {
  inputClass,
  textareaClass,
  type FieldErrors,
} from "../../../web/components/forms.tsx";
import { Icon } from "../../../web/components/icons.tsx";
import { Caption, ClientBlock, IssuerBlock } from "./invoice-parties.tsx";
import { ItemsSection } from "./items-section.tsx";
import { NfseSection } from "./nfse-section.tsx";
import { GeneratedTextsSection } from "./generated-texts-section.tsx";
import { NfseLinkSection } from "./nfse-link-section.tsx";
import { InvoiceRecordsSection } from "../../invoice-records/components/invoice-records-section.tsx";
import { PdfQuickAction, PdfSection } from "./pdf-section.tsx";
import { emptyItemFormValues } from "../invoices.view.ts";
import type { InvoiceDetail } from "../invoices.service.ts";
import { parsePartySnapshot } from "../../../domain/party-fields/snapshot.ts";

export type NfseInitial = {
  value: string;
  autofilled: boolean;
  error?: string;
  sourceSnapshot?: string;
};

/** Ordered happy-path stages; `void` sits outside the line. */
const STEPS: { key: InvoiceStatus; label: string }[] = [
  { key: "draft", label: "Draft" },
  { key: "issued", label: "Issued" },
  { key: "sent", label: "Sent" },
  { key: "paid", label: "Paid" },
];

export function InvoiceHeaderStatus({
  status,
  oob,
}: {
  status: InvoiceStatus;
  oob?: boolean;
}) {
  return (
    <span
      id="invoice-header-status"
      hx-swap-oob={oob ? "true" : undefined}
    >
      <StatusBadge status={status} />
    </span>
  );
}

/**
 * Workflow header (`#invoice-workflow`): the lifecycle stepper plus the actions
 * available in the current state. Issuing/reverting reload the page (they flip
 * the document lock); manual status changes swap this fragment in place.
 */
export function WorkflowHeader({
  invoice,
  archivedPdf,
  error,
  renderBlockedReason,
}: {
  invoice: Invoice;
  archivedPdf: FileRecord | null;
  error?: string;
  renderBlockedReason?: string;
}) {
  const status = invoice.status as InvoiceStatus;
  const draft = status === "draft";
  const id = invoice.id;
  const options = manualStatusOptions(status);
  const actionsClass =
    options.length > 0
      ? "grid w-full grid-cols-1 gap-2 sm:grid-cols-3"
      : "grid w-full grid-cols-2 gap-2";

  return (
    <div
      id="invoice-workflow"
      class="app-card lift-enter relative z-40 rounded-lg p-4"
    >
      <div class="grid gap-3">
        <Stepper status={status} />

        <div class={actionsClass}>
          {options.length > 0 ? (
            <select
              name="status"
              class="select select-bordered select-sm w-full"
              hx-post={`/invoices/${id}/status`}
              hx-trigger="change"
              hx-target="#invoice-workflow"
              hx-swap="outerHTML"
              title="Change status"
            >
              {options.map((s) => (
                <option value={s} selected={status === s}>
                  {s}
                </option>
              ))}
            </select>
          ) : null}

          {draft ? (
            <button
              type="button"
              class="btn btn-primary btn-sm w-full"
              hx-post={`/invoices/${id}/issue`}
              hx-target="#invoice-workflow"
              hx-swap="outerHTML"
              hx-confirm="Issue this invoice? Its PDF is archived and the document is locked for editing."
            >
              <Icon name="send" />
              <span>Issue</span>
            </button>
          ) : (
            <button
              type="button"
              class="btn btn-ghost btn-sm w-full"
              hx-post={`/invoices/${id}/revert`}
              hx-target="#invoice-workflow"
              hx-swap="outerHTML"
              hx-confirm={
                status === "issued"
                  ? "Revert to draft to edit the document? The archived PDF is kept."
                  : `This invoice is ${status}. Revert to draft to edit it? The archived PDF is kept.`
              }
            >
              <Icon name="undo" />
              <span>Revert to draft</span>
            </button>
          )}

          <PdfQuickAction invoice={invoice} archivedPdf={archivedPdf} renderBlockedReason={renderBlockedReason} />
        </div>
      </div>

      {draft ? (
        <div class="mt-2 flex justify-end">
          <button
            type="button"
            class="btn btn-ghost btn-xs text-error"
            hx-delete={`/invoices/${id}`}
            hx-swap="none"
            hx-confirm="Delete this draft invoice? This permanently removes it and its line items."
          >
            <Icon name="trash" />
            <span>Delete draft</span>
          </button>
        </div>
      ) : null}

      {error ? <p class="app-error mt-3 text-sm">{error}</p> : null}
    </div>
  );
}

/** Horizontal lifecycle stepper; `void` invoices show a void marker instead. */
function Stepper({ status }: { status: InvoiceStatus }) {
  if (status === "void") {
    return (
      <div class="flex items-center gap-2">
        <StatusBadge status="void" />
        <span class="text-sm text-base-content/60">
          This invoice is void.
        </span>
      </div>
    );
  }
  const current = STEPS.findIndex((s) => s.key === status);
  return (
    <ol class="flex items-center gap-1 text-sm">
      {STEPS.map((step, i) => {
        const state =
          i < current ? "done" : i === current ? "current" : "todo";
        return (
          <>
            {i > 0 ? (
              <li
                aria-hidden="true"
                class={`h-px w-5 ${i <= current ? "bg-primary/60" : "bg-base-300"}`}
              ></li>
            ) : null}
            <li class="flex items-center gap-1.5">
              <span
                class={
                  "flex h-5 w-5 items-center justify-center rounded-full text-xs font-semibold " +
                  (state === "done"
                    ? "bg-primary/80 text-primary-content"
                    : state === "current"
                      ? "bg-primary text-primary-content"
                      : "bg-base-300 text-base-content/50")
                }
              >
                {state === "done" ? "✓" : i + 1}
              </span>
              <span
                class={
                  state === "todo"
                    ? "text-base-content/45"
                    : "font-medium text-base-content/80"
                }
              >
                {step.label}
              </span>
            </li>
          </>
        );
      })}
    </ol>
  );
}

export function InvoiceDetailBody({
  detail,
  pdfFilename,
  nfse,
  pdfRenderBlockedReason,
}: {
  detail: InvoiceDetail;
  pdfFilename: string;
  /** Initial nota fiscal text (saved value, or auto-generated when empty). */
  nfse: NfseInitial;
  pdfRenderBlockedReason?: string;
}) {
  const { invoice, client, issuer, items, total, notaFiscal, archivedPdf } =
    detail;
  const editable = isDocumentEditable(invoice.status);
  const issuerSnapshot = invoice.issuerSnapshotJson
    ? parsePartySnapshot(invoice.issuerSnapshotJson)
    : undefined;
  const clientSnapshot = invoice.clientSnapshotJson
    ? parsePartySnapshot(invoice.clientSnapshotJson)
    : undefined;

  return (
    <div class="mx-auto max-w-7xl">
      <div class="grid gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <main class="min-w-0">
          <div class="app-card overflow-hidden rounded-xl">
            <div class="grid gap-5 border-b border-base-300/60 bg-base-200/25 p-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
              <IssuerBlock issuer={issuer} snapshot={issuerSnapshot} />
              <div class="lg:text-right">
                <div class="flex items-center gap-2 lg:justify-end">
                  <span class="text-lg font-semibold tracking-tight">Invoice</span>
                  <InvoiceHeaderStatus status={invoice.status as InvoiceStatus} />
                </div>
                <InvoiceDocFields invoice={invoice} />
              </div>
            </div>

            <div class="grid gap-5 border-b border-base-300/60 p-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
              <ClientBlock client={client} snapshot={clientSnapshot} />
              <div class="lg:text-right">
                <Caption>Currency</Caption>
                <div class="mt-1 font-medium">{invoice.currency}</div>
              </div>
            </div>

            <div class="p-4">
              <div class="mb-3 flex items-center justify-between">
                <Caption>Line items</Caption>
                {editable ? null : (
                  <span class="text-xs text-base-content/45">
                    Locked — revert to draft to edit
                  </span>
                )}
              </div>
              <ItemsSection
                invoiceId={invoice.id}
                currency={invoice.currency}
                items={items}
                total={total}
                locked={!editable}
                addValues={emptyItemFormValues()}
              />
            </div>

            <div class="border-t border-base-300/60 bg-base-200/25 p-4">
              <NotesEditor invoiceId={invoice.id} notes={invoice.notes ?? ""} />
            </div>
          </div>

          <section class="mt-5">
            <h2 class="mb-2 text-sm font-semibold uppercase tracking-wide text-base-content/55">
              Invoice PDF
            </h2>
            <PdfSection
              invoice={invoice}
              archivedPdf={archivedPdf}
              filename={pdfFilename}
              currentTemplate={detail.pdfTemplate}
              templates={detail.pdfTemplateOptions}
              renderBlockedReason={pdfRenderBlockedReason}
            />
          </section>
        </main>

        <aside class="grid gap-4 self-start xl:sticky xl:top-6">
          <WorkflowHeader invoice={invoice} archivedPdf={archivedPdf} renderBlockedReason={pdfRenderBlockedReason} />

          <section class="app-card rounded-lg p-5">
            <h2 class="mb-3 text-sm font-semibold uppercase tracking-wide text-base-content/55">
              NFS-e description
            </h2>
            <NfseSection
              invoiceId={invoice.id}
              value={nfse.value}
              hasTemplate={detail.textGenerators.some((generator) => generator.purpose === "nfse-description") || Boolean(client.defaultNfseDescriptionTemplate)}
              generated={nfse.autofilled}
              error={nfse.error}
              sourceSnapshot={nfse.sourceSnapshot}
            />
          </section>

          <GeneratedTextsSection
            invoiceId={invoice.id}
            generators={detail.textGenerators}
            savedTexts={detail.generatedTexts}
          />

          <InvoiceRecordsSection invoiceId={invoice.id} recordTypes={detail.recordTypes} records={detail.records} />

          {!detail.recordTypes.some((type) => type.purpose === "nfse") ? <section>
            <h2 class="mb-2 text-sm font-semibold uppercase tracking-wide text-base-content/55">
              NFS-e link
            </h2>
            <NfseLinkSection
              invoiceId={invoice.id}
              link={notaFiscal}
              pdfFile={detail.notaFiscalPdf}
              xmlFile={detail.notaFiscalXml}
              offerMarkSent={invoice.status === "issued" && notaFiscal === null}
            />
          </section> : null}
        </aside>
      </div>
    </div>
  );
}

/** Inline-editable invoice notes (`#invoice-notes`); editable in any status. */
export function NotesEditor({
  invoiceId,
  notes,
  saved,
}: {
  invoiceId: number;
  notes: string;
  saved?: boolean;
}) {
  return (
    <div id="invoice-notes" x-data={`{ open: ${notes ? "true" : "false"} }`}>
      <button
        type="button"
        class="text-sm font-medium text-base-content/70 hover:text-base-content"
        x-on:click="open = !open"
      >
        <span x-text="open ? '▾ Notes' : '▸ Notes'">▸ Notes</span>
      </button>

      <div x-show="open" class="mt-2" style={notes ? "" : "display:none"}>
        <form
          hx-post={`/invoices/${invoiceId}/notes`}
          hx-target="#invoice-notes"
          hx-swap="outerHTML"
          x-data="enhancedForm"
          data-dirty-section
        >
          <textarea
            name="notes"
            rows={2}
            class={textareaClass()}
            maxlength={2000}
            placeholder="Optional notes shown on the invoice."
            data-format="trim"
          >
            {notes}
          </textarea>
          <div class="mt-2 flex items-center justify-end gap-2">
            {saved ? (
              <span class="mr-auto text-sm text-success">Notes saved.</span>
            ) : (
              <span data-dirty-badge class="mr-auto">Unsaved changes</span>
            )}
            <button type="submit" class="btn btn-ghost btn-sm">
              Save notes
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Number + date shown on the document. For drafts these are inline-editable
 * (`#invoice-doc`); the save posts to `/invoices/:id/doc` and reloads the page
 * on success (the number/date feed the PDF filename, title, and templates).
 * Locked invoices show the static values only.
 */
export function InvoiceDocFields({
  invoice,
  errors,
}: {
  invoice: Invoice;
  errors?: FieldErrors;
}) {
  const editable = isDocumentEditable(invoice.status);
  const hasErrors = Boolean(errors && Object.keys(errors).length > 0);

  if (!editable) {
    return (
      <div class="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-1">
        <DocMeta label="Number">
          <span class="font-mono">{invoice.number}</span>
        </DocMeta>
        <DocMeta label="Date">
          <span class="tabular-nums">{invoice.invoiceDate}</span>
        </DocMeta>
      </div>
    );
  }

  return (
    <div id="invoice-doc" x-data={`{ editing: ${hasErrors ? "true" : "false"} }`}>
      <div
        x-show="!editing"
        style={hasErrors ? "display:none" : ""}
        class="mt-3"
      >
        <div class="grid grid-cols-2 gap-3 lg:grid-cols-1">
          <DocMeta label="Number">
            <span class="font-mono">{invoice.number}</span>
          </DocMeta>
          <DocMeta label="Date">
            <span class="tabular-nums">{invoice.invoiceDate}</span>
          </DocMeta>
        </div>
        <button
          type="button"
          class="btn btn-ghost btn-xs mt-2"
          x-on:click="editing = true"
        >
          <Icon name="edit" />
          <span>Edit</span>
        </button>
      </div>

      <form
        x-show="editing"
        style={hasErrors ? "" : "display:none"}
        class="mt-3 grid gap-2 text-left"
        hx-post={`/invoices/${invoice.id}/doc`}
        hx-target="#invoice-doc"
        hx-swap="outerHTML"
      >
        <label class="form-control">
          <span class="label-text text-xs font-medium">Number</span>
          <input
            name="number"
            value={invoice.number}
            class={`${inputClass(errors?.number)} input-sm font-mono`}
            maxlength={60}
            required
          />
          {errors?.number ? (
            <p class="app-error mt-1 text-xs">{errors.number}</p>
          ) : null}
        </label>
        <label class="form-control">
          <span class="label-text text-xs font-medium">Date</span>
          <input
            type="date"
            name="invoiceDate"
            value={invoice.invoiceDate}
            class={`${inputClass(errors?.invoiceDate)} input-sm tabular-nums`}
            required
          />
          {errors?.invoiceDate ? (
            <p class="app-error mt-1 text-xs">{errors.invoiceDate}</p>
          ) : null}
        </label>
        <div class="flex items-center justify-end gap-2">
          <button
            type="button"
            class="btn btn-ghost btn-xs"
            x-on:click="editing = false"
          >
            Cancel
          </button>
          <button type="submit" class="btn btn-primary btn-xs">
            Save
          </button>
        </div>
      </form>
    </div>
  );
}

function DocMeta({ label, children }: { label: string; children: unknown }) {
  return (
    <div>
      <Caption>{label}</Caption>
      <div class="mt-1">{children as never}</div>
    </div>
  );
}
