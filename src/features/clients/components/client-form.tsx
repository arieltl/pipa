import {
  Alert,
  Field,
  SubmitButton,
  inputClass,
  selectClass,
  textareaClass,
  type FieldErrors,
} from "../../../web/components/forms.tsx";
import { SUPPORTED_CURRENCIES } from "../../../domain/money.ts";
import type { NumberingProfile } from "../../../db/schema.ts";

export type ClientFormValues = {
  name: string;
  legalName: string;
  code: string;
  address: string;
  country: string;
  email: string;
  defaultCurrency: string;
  defaultFixedMonthlyValue: string;
  defaultFixedMonthlyItemNameTemplate: string;
  defaultNfseDescriptionTemplate: string;
  defaultPdfFilenameTemplate: string;
  numberingProfileId: string;
  isDefault: boolean;
};

export type ClientFormProps = {
  /** POST target: /clients for create, /clients/:id for update. */
  action: string;
  values: ClientFormValues;
  profiles: NumberingProfile[];
  errors?: FieldErrors;
  submitLabel: string;
  saved?: boolean;
};

export function ClientForm({
  action,
  values,
  profiles,
  errors = {},
  submitLabel,
  saved,
}: ClientFormProps) {
  return (
    <div id="client-form">
      {saved ? <Alert kind="success" message="Client saved." /> : null}

      <form
        hx-post={action}
        hx-target="#client-form"
        hx-swap="outerHTML"
        x-data="enhancedForm"
        data-dirty-section
        class="app-form grid sm:grid-cols-2"
      >
        <Field label="Name" name="name" required error={errors.name}>
          <input
            id="name"
            name="name"
            type="text"
            value={values.name}
            class={inputClass(errors.name)}
            autocomplete="organization"
            required
            maxlength={200}
          />
        </Field>

        <Field
          label="Code"
          name="code"
          required
          hint="Used in invoice numbers and filenames, e.g. LONDONCO"
          error={errors.code}
        >
          <input
            id="code"
            name="code"
            type="text"
            value={values.code}
            class={inputClass(errors.code)}
            autocomplete="off"
            required
            maxlength={30}
            pattern="[A-Za-z0-9_-]+"
            title="Use letters, numbers, dashes, or underscores."
            data-format="upper"
          />
        </Field>

        <Field label="Legal name" name="legalName" error={errors.legalName}>
          <input
            id="legalName"
            name="legalName"
            type="text"
            value={values.legalName}
            class={inputClass(errors.legalName)}
            maxlength={200}
            data-format="trim"
          />
        </Field>

        <Field label="Country" name="country" error={errors.country}>
          <input
            id="country"
            name="country"
            type="text"
            value={values.country}
            class={inputClass(errors.country)}
            maxlength={100}
            autocomplete="country-name"
            data-format="trim"
          />
        </Field>

        <Field label="Email" name="email" error={errors.email}>
          <input
            id="email"
            name="email"
            type="email"
            value={values.email}
            class={inputClass(errors.email)}
            maxlength={254}
            autocomplete="email"
            placeholder="billing@example.com"
          />
        </Field>

        <Field
          label="Default currency"
          name="defaultCurrency"
          error={errors.defaultCurrency}
        >
          <select
            id="defaultCurrency"
            name="defaultCurrency"
            class={selectClass(errors.defaultCurrency)}
          >
            {SUPPORTED_CURRENCIES.map((cur) => (
              <option value={cur} selected={values.defaultCurrency === cur}>
                {cur}
              </option>
            ))}
          </select>
        </Field>

        <div class="sm:col-span-2">
          <Field label="Address" name="address" error={errors.address}>
            <textarea
              id="address"
              name="address"
              rows={2}
              class={textareaClass(errors.address)}
              maxlength={1000}
              data-format="trim"
            >
              {values.address}
            </textarea>
          </Field>
        </div>

        <Field
          label="Default fixed monthly value"
          name="defaultFixedMonthlyValue"
          hint="Copied into new invoices. Leave blank if none."
          error={errors.defaultFixedMonthlyValue}
        >
          <input
            id="defaultFixedMonthlyValue"
            name="defaultFixedMonthlyValue"
            type="text"
            inputmode="decimal"
            value={values.defaultFixedMonthlyValue}
            placeholder="4000.00"
            class={inputClass(errors.defaultFixedMonthlyValue)}
            maxlength={30}
            data-format="money"
          />
        </Field>

        <Field
          label="Numbering profile"
          name="numberingProfileId"
          error={errors.numberingProfileId}
        >
          <select
            id="numberingProfileId"
            name="numberingProfileId"
            class={selectClass(errors.numberingProfileId)}
          >
            <option value="">No numbering profile</option>
            {profiles.map((p) => (
              <option
                value={String(p.id)}
                selected={values.numberingProfileId === String(p.id)}
              >
                {p.name} ({p.pattern})
              </option>
            ))}
          </select>
        </Field>

        <div class="sm:col-span-2">
          <Field
            label="Fixed monthly item name template"
            name="defaultFixedMonthlyItemNameTemplate"
            hint="e.g. {{client.name}} - Software development services - {{invoice.dateMonthName}} {{invoice.dateYear}}"
            error={errors.defaultFixedMonthlyItemNameTemplate}
          >
            <input
              id="defaultFixedMonthlyItemNameTemplate"
              name="defaultFixedMonthlyItemNameTemplate"
              type="text"
              value={values.defaultFixedMonthlyItemNameTemplate}
              class={inputClass(errors.defaultFixedMonthlyItemNameTemplate)}
              maxlength={500}
              data-format="trim"
            />
          </Field>
        </div>

        <div class="sm:col-span-2">
          <Field
            label="Nota fiscal description template"
            name="defaultNfseDescriptionTemplate"
            hint="Default NFS-e description text. Editable per invoice later."
            error={errors.defaultNfseDescriptionTemplate}
          >
            <textarea
              id="defaultNfseDescriptionTemplate"
              name="defaultNfseDescriptionTemplate"
              rows={3}
              class={textareaClass(errors.defaultNfseDescriptionTemplate)}
              maxlength={2000}
              data-format="trim"
            >
              {values.defaultNfseDescriptionTemplate}
            </textarea>
          </Field>
        </div>

        <div class="sm:col-span-2">
          <Field
            label="PDF filename template"
            name="defaultPdfFilenameTemplate"
            hint="e.g. {{invoice.number}}_{{client.code}}_{{invoice.date}}.pdf"
            error={errors.defaultPdfFilenameTemplate}
          >
            <input
              id="defaultPdfFilenameTemplate"
              name="defaultPdfFilenameTemplate"
              type="text"
              value={values.defaultPdfFilenameTemplate}
              class={inputClass(errors.defaultPdfFilenameTemplate)}
              maxlength={300}
              data-format="trim"
            />
          </Field>
        </div>

        <div class="sm:col-span-2">
          <label class="app-card flex cursor-pointer items-start gap-3 rounded-lg p-4 transition hover:border-primary/30">
            <input
              type="checkbox"
              name="isDefault"
              class="checkbox checkbox-sm"
              checked={values.isDefault}
            />
            <span class="text-sm">
              Make this the default client for new invoices
            </span>
          </label>
        </div>

        <div class="sm:col-span-2 flex items-center justify-end gap-2">
          <span data-dirty-badge class="mr-auto">Unsaved changes</span>
          <a href="/clients" class="btn btn-ghost">
            Cancel
          </a>
          <SubmitButton label={submitLabel} />
        </div>
      </form>
    </div>
  );
}
