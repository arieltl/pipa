import type { Client } from "../../../db/schema.ts";
import { SUPPORTED_CURRENCIES } from "../../../domain/money.ts";
import { ITEM_SOURCES } from "../invoices.schema.ts";
import type { ClientSeed, ItemDraft } from "../invoices.service.ts";
import {
  Alert,
  Field,
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

export type InvoiceFormProps = {
  values: InvoiceFormValues;
  clients: Client[];
  /** Per-client seed defaults (currency + fixed item) for client switching. */
  seedMap: Record<string, ClientSeed>;
  errors?: FieldErrors;
};

const SOURCE_LABEL: Record<string, string> = {
  fixed_monthly: "Fixed monthly",
  expense: "Expense",
  other: "Other",
};

export function InvoiceForm({
  values,
  clients,
  seedMap,
  errors = {},
}: InvoiceFormProps) {
  const config = {
    clientId: values.clientId,
    currency: values.currency,
    items: values.items,
    seeds: seedMap,
  };
  return (
    <div id="invoice-form">
      {errors._form ? <Alert kind="error" message={errors._form} /> : null}

      <form
        hx-post="/invoices"
        hx-target="#invoice-form"
        hx-swap="outerHTML"
        x-data={`invoiceCreate(${JSON.stringify(config)})`}
        data-dirty-section
        class="app-form grid sm:grid-cols-2"
      >
        <input type="hidden" name="items" x-bind:value="JSON.stringify(items)" />

        <Field label="Client" name="clientId" required error={errors.clientId}>
          <select
            id="clientId"
            name="clientId"
            class={selectClass(errors.clientId)}
            x-model="clientId"
            x-on:change="onClientChange()"
            required
          >
            <option value="" selected={values.clientId === ""}>
              Select a client…
            </option>
            {clients.map((client) => (
              <option
                value={String(client.id)}
                selected={values.clientId === String(client.id)}
              >
                {client.name} ({client.code})
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Invoice date"
          name="invoiceDate"
          required
          hint="Date shown on the PDF — not the creation date."
          error={errors.invoiceDate}
        >
          <input
            id="invoiceDate"
            name="invoiceDate"
            type="date"
            value={values.invoiceDate}
            class={inputClass(errors.invoiceDate)}
            required
          />
        </Field>

        <Field
          label="Currency"
          name="currency"
          hint=" "
          error={errors.currency}
        >
          <select
            id="currency"
            name="currency"
            class={selectClass(errors.currency)}
            x-model="currency"
          >
            {SUPPORTED_CURRENCIES.map((cur) => (
              <option value={cur} selected={values.currency === cur}>
                {cur}
              </option>
            ))}
          </select>
          <span
            class="app-hint mt-1 block text-xs"
            x-text="currencyDefault ? '(client default: ' + currencyDefault + ')' : ''"
          ></span>
        </Field>

        <Field
          label="Manual number"
          name="manualNumber"
          hint="Leave blank to auto-generate from the client's numbering profile."
          error={errors.manualNumber}
        >
          <input
            id="manualNumber"
            name="manualNumber"
            type="text"
            value={values.manualNumber}
            placeholder="e.g. ACME-2026-001"
            autocomplete="off"
            class={inputClass(errors.manualNumber)}
            maxlength={60}
            title="Use a concise invoice number. It will be uppercased."
            data-format="upper"
          />
        </Field>

        <div class="sm:col-span-2">
          <ItemsEditor errors={errors} />
        </div>

        <div class="sm:col-span-2">
          <Field label="Notes" name="notes" error={errors.notes}>
            <textarea
              id="notes"
              name="notes"
              rows={2}
              class={textareaClass(errors.notes)}
              maxlength={2000}
              data-format="trim"
            >
              {values.notes}
            </textarea>
          </Field>
        </div>

        <div class="sm:col-span-2 flex items-center justify-end gap-2">
          <span data-dirty-badge class="mr-auto">Unsaved changes</span>
          <a href="/invoices" class="btn btn-ghost">
            Cancel
          </a>
          <SubmitButton label="Create invoice" />
        </div>
      </form>
    </div>
  );
}

/** Client-side editable line items, driven by the `invoiceCreate` Alpine data. */
function ItemsEditor({ errors }: { errors: FieldErrors }) {
  // Item errors arrive keyed by path, e.g. `items.0.value`; surface the first.
  const itemError = Object.entries(errors).find(
    ([key]) => key === "items" || key.startsWith("items."),
  )?.[1];
  return (
    <div class="app-card rounded-lg p-4">
      <div class="mb-3 flex items-center justify-between">
        <h3 class="text-sm font-semibold text-base-content/70">Line items</h3>
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
                No items. Add one, or pick a client to seed the fixed monthly
                item.
              </td>
            </tr>
          </tbody>
          <tfoot>
            <tr class="border-t-2 border-base-300">
              <th>Total</th>
              <th class="text-right tabular-nums">
                <span x-text="formattedTotal"></span>
              </th>
              <th colspan={2}></th>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
