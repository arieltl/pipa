import type { InvoiceItem } from "../../../db/schema.ts";
import { formatMoney } from "../../../domain/money.ts";
import {
  Field,
  inputClass,
  selectClass,
  type FieldErrors,
} from "../../../web/components/forms.tsx";
import { ITEM_SOURCES } from "../invoices.schema.ts";

export type ItemFormValues = {
  name: string;
  value: string;
  source: string;
  notes: string;
};

const SOURCE_LABEL: Record<string, string> = {
  fixed_monthly: "Fixed monthly",
  expense: "Expense",
  other: "Other",
};

export type ItemsSectionProps = {
  invoiceId: number;
  currency: string;
  items: InvoiceItem[];
  total: number;
  /** Item currently in inline-edit mode, if any. */
  editingItemId?: number;
  editValues?: ItemFormValues;
  editErrors?: FieldErrors;
  /** State for the add-item form (preserved across validation errors). */
  addValues: ItemFormValues;
  addErrors?: FieldErrors;
};

/**
 * The `#invoice-items` fragment: line items table, total, and the add-item
 * form. Every item mutation re-renders this whole section so the total stays
 * consistent (spec §8). Editing swaps a single row for an inline form.
 */
export function ItemsSection(props: ItemsSectionProps) {
  const { invoiceId, currency, items, total } = props;
  return (
    <div id="invoice-items">
      <div class="overflow-x-auto rounded-lg border border-base-300 bg-base-100">
        <table class="table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Type</th>
              <th class="text-right">Value</th>
              <th class="w-px"></th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colspan={4} class="text-center text-sm text-base-content/50">
                  No items yet. Add one below.
                </td>
              </tr>
            ) : (
              items.map((item) =>
                props.editingItemId === item.id ? (
                  <ItemEditRow
                    invoiceId={invoiceId}
                    itemId={item.id}
                    currency={currency}
                    values={props.editValues ?? toValues(item)}
                    errors={props.editErrors}
                  />
                ) : (
                  <ItemDisplayRow
                    invoiceId={invoiceId}
                    item={item}
                    currency={currency}
                  />
                ),
              )
            )}
          </tbody>
          <tfoot>
            <tr class="border-t-2 border-base-300">
              <th colspan={2}>Total</th>
              <th class="text-right tabular-nums text-base">
                {formatMoney(total, currency)}
              </th>
              <th></th>
            </tr>
          </tfoot>
        </table>
      </div>

      <AddItemForm
        invoiceId={invoiceId}
        currency={currency}
        values={props.addValues}
        errors={props.addErrors}
      />
    </div>
  );
}

function toValues(item: InvoiceItem): ItemFormValues {
  return {
    name: item.name,
    value: "",
    source: item.source,
    notes: item.notes ?? "",
  };
}

function ItemDisplayRow({
  invoiceId,
  item,
  currency,
}: {
  invoiceId: number;
  item: InvoiceItem;
  currency: string;
}) {
  return (
    <tr class="hover">
      <td>
        <div class="font-medium">{item.name}</div>
        {item.notes ? (
          <div class="text-xs text-base-content/50">{item.notes}</div>
        ) : null}
      </td>
      <td>
        <span class="badge badge-ghost badge-sm">
          {SOURCE_LABEL[item.source] ?? item.source}
        </span>
      </td>
      <td class="text-right tabular-nums">{formatMoney(item.value, currency)}</td>
      <td class="whitespace-nowrap text-right">
        <button
          type="button"
          class="btn btn-ghost btn-xs"
          hx-get={`/invoices/${invoiceId}/items/${item.id}/edit`}
          hx-target="#invoice-items"
          hx-swap="outerHTML"
        >
          Edit
        </button>
        <button
          type="button"
          class="btn btn-ghost btn-xs text-error"
          hx-delete={`/invoices/${invoiceId}/items/${item.id}`}
          hx-target="#invoice-items"
          hx-swap="outerHTML"
          hx-confirm="Delete this item?"
        >
          Delete
        </button>
      </td>
    </tr>
  );
}

function ItemEditRow({
  invoiceId,
  itemId,
  currency,
  values,
  errors = {},
}: {
  invoiceId: number;
  itemId: number;
  currency: string;
  values: ItemFormValues;
  errors?: FieldErrors;
}) {
  const formId = `edit-item-${itemId}`;
  return (
    <tr>
      <td colspan={4} class="bg-base-200/50">
        <form
          id={formId}
          hx-post={`/invoices/${invoiceId}/items/${itemId}`}
          hx-target="#invoice-items"
          hx-swap="outerHTML"
          class="grid gap-3 sm:grid-cols-2"
        >
          <input type="hidden" name="currency" value={currency} />
          <ItemFields values={values} errors={errors} />
          <div class="sm:col-span-2 flex justify-end gap-2">
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              hx-get={`/invoices/${invoiceId}/items`}
              hx-target="#invoice-items"
              hx-swap="outerHTML"
            >
              Cancel
            </button>
            <button type="submit" class="btn btn-primary btn-sm">
              Save item
            </button>
          </div>
        </form>
      </td>
    </tr>
  );
}

function AddItemForm({
  invoiceId,
  currency,
  values,
  errors = {},
}: {
  invoiceId: number;
  currency: string;
  values: ItemFormValues;
  errors?: FieldErrors;
}) {
  return (
    <div class="mt-4 rounded-lg border border-base-300 bg-base-100 p-4">
      <h3 class="mb-3 text-sm font-semibold text-base-content/70">Add item</h3>
      <form
        hx-post={`/invoices/${invoiceId}/items`}
        hx-target="#invoice-items"
        hx-swap="outerHTML"
        class="grid gap-3 sm:grid-cols-2"
      >
        <input type="hidden" name="currency" value={currency} />
        <ItemFields values={values} errors={errors} />
        <div class="sm:col-span-2 flex justify-end">
          <button type="submit" class="btn btn-primary btn-sm">
            Add item
          </button>
        </div>
      </form>
    </div>
  );
}

/** Shared name/value/source/notes inputs for add + edit forms. */
function ItemFields({
  values,
  errors = {},
}: {
  values: ItemFormValues;
  errors?: FieldErrors;
}) {
  return (
    <>
      <Field label="Description" name="name" required error={errors.name}>
        <input
          name="name"
          type="text"
          value={values.name}
          autocomplete="off"
          class={inputClass(errors.name)}
        />
      </Field>

      <Field label="Value" name="value" required error={errors.value}>
        <input
          name="value"
          type="text"
          inputmode="decimal"
          value={values.value}
          placeholder="120.00"
          class={inputClass(errors.value)}
        />
      </Field>

      <Field label="Type" name="source" error={errors.source}>
        <select name="source" class={selectClass(errors.source)}>
          {ITEM_SOURCES.map((src) => (
            <option value={src} selected={values.source === src}>
              {SOURCE_LABEL[src]}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Notes" name="notes" error={errors.notes}>
        <input
          name="notes"
          type="text"
          value={values.notes}
          autocomplete="off"
          class={inputClass(errors.notes)}
        />
      </Field>
    </>
  );
}
