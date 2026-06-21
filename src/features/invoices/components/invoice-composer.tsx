import type { Client, IssuerSettings } from "../../../db/schema.ts";
import { SUPPORTED_CURRENCIES } from "../../../domain/money.ts";
import { ITEM_SOURCES } from "../invoices.schema.ts";
import type { ItemDraft } from "../invoices.service.ts";
import {
  Alert,
  SubmitButton,
  inputClass,
  selectClass,
  textareaClass,
  type FieldErrors,
} from "../../../web/components/forms.tsx";

export type InvoiceFormValues = {
  clientId: string;
  invoiceDate: string;
  currency: string;
  manualNumber: string;
  notes: string;
  items: ItemDraft[];
};

export type InvoiceComposerProps = {
  client: Client;
  issuer: IssuerSettings | null;
  values: InvoiceFormValues;
  /** The client's default currency, shown as a hint. */
  currencyDefault: string;
  /** Whether the client has a numbering profile (auto numbers) or needs manual. */
  hasProfile: boolean;
  errors?: FieldErrors;
};

const SOURCE_LABEL: Record<string, string> = {
  fixed_monthly: "Fixed monthly",
  expense: "Expense",
  other: "Other",
};

/**
 * Invoice "document" composer: the create page resembles the invoice it will
 * produce (FROM / BILL TO / meta / line items / total). The client is fixed —
 * it is chosen before reaching this page — so there is no client picker here.
 */
export function InvoiceComposer({
  client,
  issuer,
  values,
  currencyDefault,
  hasProfile,
  errors = {},
}: InvoiceComposerProps) {
  const config = {
    currency: values.currency,
    items: values.items,
  };
  return (
    <div id="invoice-form">
      {errors._form ? <Alert kind="error" message={errors._form} /> : null}

      <form
        hx-post="/invoices"
        hx-target="#invoice-form"
        hx-swap="outerHTML"
        x-data={`invoiceCompose(${JSON.stringify(config)})`}
        data-dirty-section
        class="app-card overflow-hidden rounded-xl"
      >
        <input type="hidden" name="clientId" value={String(client.id)} />
        <input type="hidden" name="items" x-bind:value="JSON.stringify(items)" />

        {/* FROM + invoice meta */}
        <div class="grid gap-6 border-b border-base-300/60 bg-base-200/25 p-6 sm:grid-cols-2">
          <div>
            <Caption>From</Caption>
            {issuer ? (
              <div class="mt-1 space-y-0.5">
                <div class="font-semibold">{issuer.legalName || issuer.name}</div>
                {issuer.cnpj ? (
                  <div class="text-sm text-base-content/60">
                    CNPJ {issuer.cnpj}
                  </div>
                ) : null}
                {issuer.address ? (
                  <div class="whitespace-pre-line text-sm text-base-content/60">
                    {issuer.address}
                  </div>
                ) : null}
              </div>
            ) : (
              <a href="/settings/issuer" class="link link-hover mt-1 block text-sm">
                Set up your issuer details →
              </a>
            )}
          </div>

          <div class="sm:text-right">
            <div class="flex items-center gap-2 sm:justify-end">
              <span class="text-lg font-semibold tracking-tight">Invoice</span>
              <span class="app-status app-status-draft">draft</span>
            </div>

            <div class="mt-4 grid gap-3">
              <NumberField values={values} hasProfile={hasProfile} errors={errors} />
              <label class="block">
                <Caption>Date</Caption>
                <input
                  name="invoiceDate"
                  type="date"
                  value={values.invoiceDate}
                  class={`${inputClass(errors.invoiceDate)} mt-1 sm:text-right`}
                  required
                />
                {errors.invoiceDate ? (
                  <span class="app-error mt-1 inline-flex text-xs">
                    {errors.invoiceDate}
                  </span>
                ) : null}
              </label>
            </div>
          </div>
        </div>

        {/* BILL TO + currency */}
        <div class="grid gap-6 border-b border-base-300/60 p-6 sm:grid-cols-2">
          <div>
            <Caption>Bill to</Caption>
            <div class="mt-1 flex items-center gap-2">
              <span class="font-semibold">{client.name}</span>
              <span class="badge badge-sm app-code-badge font-mono">
                {client.code}
              </span>
            </div>
            {client.legalName ? (
              <div class="text-sm text-base-content/60">{client.legalName}</div>
            ) : null}
            {client.address ? (
              <div class="whitespace-pre-line text-sm text-base-content/60">
                {client.address}
              </div>
            ) : null}
            {client.country ? (
              <div class="text-sm text-base-content/60">{client.country}</div>
            ) : null}
          </div>

          <div class="sm:text-right">
            <Caption>Currency</Caption>
            <select
              name="currency"
              class={`${selectClass(errors.currency)} mt-1 sm:ml-auto sm:max-w-[10rem]`}
              x-model="currency"
            >
              {SUPPORTED_CURRENCIES.map((cur) => (
                <option value={cur} selected={values.currency === cur}>
                  {cur}
                </option>
              ))}
            </select>
            <div class="app-hint mt-1 text-xs">
              Client default: {currencyDefault}
            </div>
          </div>
        </div>

        {/* Line items */}
        <div class="p-6">
          <ItemsEditor errors={errors} />
        </div>

        {/* Notes + footer */}
        <div
          class="border-t border-base-300/60 bg-base-200/25 p-6"
          x-data={`{ notesOpen: ${values.notes ? "true" : "false"} }`}
        >
          <button
            type="button"
            class="text-sm font-medium text-base-content/70 hover:text-base-content"
            x-on:click="notesOpen = !notesOpen"
          >
            <span x-text="notesOpen ? '▾ Notes' : '▸ Notes'">▸ Notes</span>
          </button>
          <div x-show="notesOpen" class="mt-2" style="display:none">
            <textarea
              name="notes"
              rows={2}
              class={textareaClass(errors.notes)}
              maxlength={2000}
              placeholder="Optional notes shown on the invoice."
              data-format="trim"
            >
              {values.notes}
            </textarea>
          </div>

          <div class="mt-5 flex flex-wrap items-center justify-end gap-3 border-t border-base-300/60 pt-5">
            <div class="mr-auto">
              <span data-dirty-badge>Unsaved changes</span>
            </div>
            <div class="text-right">
              <div class="text-xs uppercase tracking-wide text-base-content/50">
                Total
              </div>
              <div
                class="text-2xl font-semibold tabular-nums"
                x-text="formattedTotal"
              ></div>
            </div>
            <a href={`/clients/${client.id}`} class="btn btn-ghost">
              Cancel
            </a>
            <SubmitButton label="Create invoice" />
          </div>
        </div>
      </form>
    </div>
  );
}

function Caption({ children }: { children: unknown }) {
  return (
    <div class="text-xs font-semibold uppercase tracking-wide text-base-content/45">
      {children as never}
    </div>
  );
}

/** Invoice number: auto by default (with a manual toggle), or required manual. */
function NumberField({
  values,
  hasProfile,
  errors,
}: {
  values: InvoiceFormValues;
  hasProfile: boolean;
  errors: FieldErrors;
}) {
  const manualInput = (
    <input
      name="manualNumber"
      type="text"
      value={values.manualNumber}
      placeholder="e.g. ACME-2026-001"
      autocomplete="off"
      class={`${inputClass(errors.manualNumber)} mt-1 sm:text-right`}
      maxlength={60}
      title="Use a concise invoice number. It will be uppercased."
      data-format="upper"
    />
  );

  if (!hasProfile) {
    return (
      <label class="block">
        <Caption>Number</Caption>
        {manualInput}
        <span class="app-hint mt-1 block text-xs">
          This client has no numbering profile — enter a number.
        </span>
        {errors.manualNumber ? (
          <span class="app-error mt-1 inline-flex text-xs">
            {errors.manualNumber}
          </span>
        ) : null}
      </label>
    );
  }

  return (
    <div x-data={`{ manual: ${values.manualNumber ? "true" : "false"} }`}>
      <div class="flex items-center gap-2 sm:justify-end">
        <Caption>Number</Caption>
        <button
          type="button"
          class="text-xs text-base-content/55 hover:text-base-content"
          x-on:click="manual = !manual"
          x-text="manual ? 'use auto' : 'set manually'"
        >
          set manually
        </button>
      </div>
      <div x-show="!manual" class="mt-1 text-sm text-base-content/70 sm:text-right">
        Auto-generated on create
      </div>
      <div x-show="manual" style="display:none">
        {manualInput}
        {errors.manualNumber ? (
          <span class="app-error mt-1 inline-flex text-xs">
            {errors.manualNumber}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** Editable line items, driven by the `invoiceCompose` Alpine data. */
function ItemsEditor({ errors }: { errors: FieldErrors }) {
  // Item errors arrive keyed by path, e.g. `items.0.value`; surface the first.
  const itemError = Object.entries(errors).find(
    ([key]) => key === "items" || key.startsWith("items."),
  )?.[1];
  return (
    <div>
      <div class="mb-3 flex items-center justify-between">
        <Caption>Line items</Caption>
        <button type="button" class="btn btn-ghost btn-xs" x-on:click="addItem()">
          + Add item
        </button>
      </div>

      {itemError ? <Alert kind="error" message={itemError} /> : null}

      <div class="overflow-x-auto">
        <table class="table table-sm">
          <thead>
            <tr>
              <th>Description</th>
              <th class="w-32">Value</th>
              <th class="w-32">Type</th>
              <th class="w-px"></th>
            </tr>
          </thead>
          <tbody>
            <template x-for="(item, i) in items" x-bind:key="i">
              <tr>
                <td>
                  <input
                    type="text"
                    class="input input-bordered input-sm app-control w-full"
                    x-model="item.name"
                    placeholder="Item description"
                    maxlength={300}
                  />
                </td>
                <td>
                  <input
                    type="text"
                    inputmode="decimal"
                    class="input input-bordered input-sm app-control w-full text-right"
                    x-model="item.value"
                    placeholder="0.00"
                    maxlength={30}
                  />
                </td>
                <td>
                  <select
                    class="select select-bordered select-sm app-control w-full"
                    x-model="item.source"
                  >
                    {ITEM_SOURCES.map((src) => (
                      <option value={src}>{SOURCE_LABEL[src]}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <button
                    type="button"
                    class="btn btn-ghost btn-xs text-error"
                    x-on:click="removeItem(i)"
                    title="Remove item"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            </template>
            <tr x-show="items.length === 0">
              <td colspan={4} class="text-center text-sm text-base-content/50">
                No items yet. Add one above.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
