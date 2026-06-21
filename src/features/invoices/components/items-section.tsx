import type { InvoiceItem } from "../../../db/schema.ts";
import { formatMoney } from "../../../domain/money.ts";
import {
  SubmitButton,
  inputClass,
  selectClass,
  type FieldErrors,
} from "../../../web/components/forms.tsx";
import { Icon } from "../../../web/components/icons.tsx";
import { ITEM_SOURCES } from "../invoices.schema.ts";

export type ItemFormValues = {
  name: string;
  value: string;
  source: string;
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
        <table class="table table-sm">
          <thead>
            <tr>
              <th>Item</th>
              <th class="w-40">Type</th>
              <th class="w-40 text-right">Value</th>
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

      {locked ? null : <AddItemForm invoiceId={invoiceId} currency={currency} values={props.addValues} errors={props.addErrors} />}
    </div>
  );
}

function toValues(item: InvoiceItem): ItemFormValues {
  return {
    name: item.name,
    value: "",
    source: item.source,
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
          <Icon name="edit" />
          <span>Edit</span>
        </button>
        <button
          type="button"
          class="btn btn-ghost btn-xs text-error"
          hx-delete={`/invoices/${invoiceId}/items/${item.id}`}
          hx-target="#invoice-items"
          hx-swap="outerHTML"
          hx-confirm="Delete this item?"
        >
          <Icon name="trash" />
          <span>Delete</span>
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
    <>
      <tr class="bg-base-200/50">
        <td class="min-w-80">
        <form
          id={formId}
          hx-post={`/invoices/${invoiceId}/items/${itemId}`}
          hx-target="#invoice-items"
          hx-swap="outerHTML"
          x-data="enhancedForm"
          data-dirty-section
        >
          <input type="hidden" name="currency" value={currency} />
          <ItemNameInput formId={formId} values={values} errors={errors} />
        </form>
        </td>
        <td>
          <ItemSourceSelect formId={formId} values={values} errors={errors} />
        </td>
        <td>
          <ItemValueInput formId={formId} values={values} errors={errors} />
        </td>
        <td class="whitespace-nowrap text-right">
          <button
            type="button"
            class="btn btn-ghost btn-xs"
            hx-get={`/invoices/${invoiceId}/items`}
            hx-target="#invoice-items"
            hx-swap="outerHTML"
          >
            <span>Cancel</span>
          </button>
          <SubmitButton label="Save" size="sm" formId={formId} />
        </td>
      </tr>
      <ErrorRow errors={errors} />
    </>
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
  const formId = "add-invoice-item";
  return (
    <div class="mt-3 overflow-x-auto rounded-lg border border-dashed border-base-300/70 bg-base-200/20 p-2">
      <form
        id={formId}
        hx-post={`/invoices/${invoiceId}/items`}
        hx-target="#invoice-items"
        hx-swap="outerHTML"
        x-data="enhancedForm"
        data-dirty-section
        class="grid min-w-[44rem] grid-cols-[minmax(16rem,1fr)_10rem_10rem_auto] items-start gap-2"
      >
        <input type="hidden" name="currency" value={currency} />
        <ItemNameInput formId={formId} values={values} errors={errors} placeholder="New item description" />
        <ItemSourceSelect formId={formId} values={values} errors={errors} />
        <ItemValueInput formId={formId} values={values} errors={errors} />
        <SubmitButton label="Add" size="sm" />
      </form>
      <ErrorList errors={errors} />
    </div>
  );
}

function ItemNameInput({
  formId,
  values,
  errors = {},
  placeholder = "Item description",
}: {
  formId: string;
  values: ItemFormValues;
  errors?: FieldErrors;
  placeholder?: string;
}) {
  return (
    <input
      form={formId}
      name="name"
      type="text"
      value={values.name}
      autocomplete="off"
      class={`${inputClass(errors.name)} input-sm`}
      placeholder={placeholder}
      required
      maxlength={300}
      data-format="trim"
      aria-label="Item description"
    />
  );
}

function ItemValueInput({
  formId,
  values,
  errors = {},
}: {
  formId: string;
  values: ItemFormValues;
  errors?: FieldErrors;
}) {
  return (
    <input
      form={formId}
      name="value"
      type="text"
      inputmode="decimal"
      value={values.value}
      placeholder="120.00"
      class={`${inputClass(errors.value)} input-sm text-right tabular-nums`}
      required
      maxlength={30}
      title="Enter a valid amount, e.g. 120.00."
      data-format="money"
      aria-label="Item value"
    />
  );
}

function ItemSourceSelect({
  formId,
  values,
  errors = {},
}: {
  formId: string;
  values: ItemFormValues;
  errors?: FieldErrors;
}) {
  return (
    <select
      form={formId}
      name="source"
      class={`${selectClass(errors.source)} select-sm`}
      aria-label="Item type"
    >
      {ITEM_SOURCES.map((src) => (
        <option value={src} selected={values.source === src}>
          {SOURCE_LABEL[src]}
        </option>
      ))}
    </select>
  );
}

function ErrorRow({ errors = {} }: { errors?: FieldErrors }) {
  const messages = errorMessages(errors);
  if (messages.length === 0) return null;
  return (
    <tr class="bg-base-200/50">
      <td colspan={4}>
        <ErrorList errors={errors} />
      </td>
    </tr>
  );
}

function ErrorList({ errors = {} }: { errors?: FieldErrors }) {
  const messages = errorMessages(errors);
  if (messages.length === 0) return null;
  return (
    <div class="flex flex-wrap gap-2 px-1 py-2">
      {messages.map((message) => (
        <span class="app-error text-xs">{message}</span>
      ))}
    </div>
  );
}

function errorMessages(errors: FieldErrors): string[] {
  return Object.values(errors).filter((message): message is string =>
    Boolean(message),
  );
}
