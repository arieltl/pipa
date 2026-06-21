import type { InvoiceItem } from "../../../db/schema.ts";
import { formatMoney } from "../../../domain/money.ts";
import {
  Field,
  SubmitButton,
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
  /** When true the invoice is not a draft: items are read-only (no add/edit). */
  locked?: boolean;
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
 * consistent (spec §8). Editing swaps a single row for an inline form. When the
 * invoice is locked (issued+), rows are read-only and the add form is hidden.
 */
export function ItemsSection(props: ItemsSectionProps) {
  const { invoiceId, currency, items, total, locked = false } = props;
  return (
    <div id="invoice-items">
      <div class="app-table overflow-x-auto rounded-lg">
        <table class="table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Type</th>
              <th class="text-right">Value</th>
              {locked ? null : <th class="w-px"></th>}
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td
                  colspan={locked ? 3 : 4}
                  class="text-center text-sm text-base-content/50"
                >
                  {locked ? "No items." : "No items yet. Add one below."}
                </td>
              </tr>
            ) : (
              items.map((item) =>
                !locked && props.editingItemId === item.id ? (
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
                    locked={locked}
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
              {locked ? null : <th></th>}
            </tr>
          </tfoot>
        </table>
      </div>

      {locked ? null : (
        <AddItemForm
          invoiceId={invoiceId}
          currency={currency}
          values={props.addValues}
          errors={props.addErrors}
        />
      )}
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
  locked = false,
}: {
  invoiceId: number;
  item: InvoiceItem;
  currency: string;
  locked?: boolean;
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
      {locked ? null : (
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
      )}
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
          x-data="enhancedForm"
          data-dirty-section
          class="app-form grid sm:grid-cols-2"
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
            <SubmitButton label="Save item" size="sm" />
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
    <div class="app-card mt-4 rounded-lg p-4">
      <h3 class="mb-3 text-sm font-semibold text-base-content/70">Add item</h3>
      <form
        hx-post={`/invoices/${invoiceId}/items`}
        hx-target="#invoice-items"
        hx-swap="outerHTML"
        x-data="enhancedForm"
        data-dirty-section
        class="app-form grid sm:grid-cols-2"
      >
        <input type="hidden" name="currency" value={currency} />
        <ItemFields values={values} errors={errors} />
        <div class="sm:col-span-2 flex justify-end">
          <SubmitButton label="Add item" size="sm" />
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
          required
          maxlength={300}
          data-format="trim"
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
          required
          maxlength={30}
          title="Enter a valid amount, e.g. 120.00."
          data-format="money"
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
          maxlength={1000}
          data-format="trim"
        />
      </Field>
    </>
  );
}
