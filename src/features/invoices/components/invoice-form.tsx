import type { Client } from "../../../db/schema.ts";
import { SUPPORTED_CURRENCIES } from "../../../domain/money.ts";
import {
  Alert,
  Field,
  inputClass,
  selectClass,
  textareaClass,
  type FieldErrors,
} from "../../../web/components/forms.tsx";

export type InvoiceFormValues = {
  clientId: string;
  invoiceDate: string;
  currency: string;
  includeFixedMonthly: boolean;
  manualNumber: string;
  notes: string;
};

export type InvoiceFormProps = {
  values: InvoiceFormValues;
  clients: Client[];
  errors?: FieldErrors;
};

export function InvoiceForm({ values, clients, errors = {} }: InvoiceFormProps) {
  return (
    <div id="invoice-form">
      {errors._form ? <Alert kind="error" message={errors._form} /> : null}

      <form
        hx-post="/invoices"
        hx-target="#invoice-form"
        hx-swap="outerHTML"
        class="grid gap-4 sm:grid-cols-2"
      >
        <Field label="Client" name="clientId" required error={errors.clientId}>
          <select
            id="clientId"
            name="clientId"
            class={selectClass(errors.clientId)}
          >
            <option value="">Select a client…</option>
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
          />
        </Field>

        <Field label="Currency" name="currency" error={errors.currency}>
          <select
            id="currency"
            name="currency"
            class={selectClass(errors.currency)}
          >
            {SUPPORTED_CURRENCIES.map((cur) => (
              <option value={cur} selected={values.currency === cur}>
                {cur}
              </option>
            ))}
          </select>
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
          />
        </Field>

        <div class="sm:col-span-2">
          <label class="flex cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              name="includeFixedMonthly"
              class="checkbox checkbox-sm"
              checked={values.includeFixedMonthly}
            />
            <span class="text-sm">
              Include the client's default fixed monthly service item
            </span>
          </label>
        </div>

        <div class="sm:col-span-2">
          <Field label="Notes" name="notes" error={errors.notes}>
            <textarea
              id="notes"
              name="notes"
              rows={2}
              class={textareaClass(errors.notes)}
            >
              {values.notes}
            </textarea>
          </Field>
        </div>

        <div class="sm:col-span-2 flex items-center justify-end gap-2">
          <a href="/invoices" class="btn btn-ghost">
            Cancel
          </a>
          <button type="submit" class="btn btn-primary">
            Create invoice
          </button>
        </div>
      </form>
    </div>
  );
}
