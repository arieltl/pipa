import {
  Alert,
  Field,
  inputClass,
  selectClass,
  textareaClass,
  type FieldErrors,
} from "../../../web/components/forms.tsx";
import { SUPPORTED_CURRENCIES } from "../../../domain/money.ts";

export type IssuerFormValues = {
  name: string;
  legalName: string;
  cnpj: string;
  address: string;
  email: string;
  bankDetails: string;
  pixKey: string;
  defaultCurrency: string;
  defaultPdfFilenameTemplate: string;
};

export type IssuerFormProps = {
  values: IssuerFormValues;
  errors?: FieldErrors;
  saved?: boolean;
};

/**
 * Issuer settings form. Submits via htmx and swaps itself (outerHTML), so the
 * same fragment renders the empty form, validation errors (422), and the
 * saved-confirmation state.
 */
export function IssuerForm({ values, errors = {}, saved }: IssuerFormProps) {
  return (
    <div id="issuer-form">
      {saved ? <Alert kind="success" message="Issuer settings saved." /> : null}

      <form
        hx-post="/settings/issuer"
        hx-target="#issuer-form"
        hx-swap="outerHTML"
        class="grid gap-4 sm:grid-cols-2"
      >
        <div class="sm:col-span-2">
          <Field label="Issuer name" name="name" required error={errors.name}>
            <input
              id="name"
              name="name"
              type="text"
              value={values.name}
              class={inputClass(errors.name)}
              autocomplete="off"
            />
          </Field>
        </div>

        <Field label="Legal name" name="legalName" error={errors.legalName}>
          <input
            id="legalName"
            name="legalName"
            type="text"
            value={values.legalName}
            class={inputClass(errors.legalName)}
          />
        </Field>

        <Field label="CNPJ" name="cnpj" error={errors.cnpj}>
          <input
            id="cnpj"
            name="cnpj"
            type="text"
            value={values.cnpj}
            class={inputClass(errors.cnpj)}
          />
        </Field>

        <div class="sm:col-span-2">
          <Field label="Address" name="address" error={errors.address}>
            <textarea
              id="address"
              name="address"
              rows={2}
              class={textareaClass(errors.address)}
            >
              {values.address}
            </textarea>
          </Field>
        </div>

        <Field label="Email" name="email" error={errors.email}>
          <input
            id="email"
            name="email"
            type="email"
            value={values.email}
            class={inputClass(errors.email)}
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

        <Field label="PIX key" name="pixKey" error={errors.pixKey}>
          <input
            id="pixKey"
            name="pixKey"
            type="text"
            value={values.pixKey}
            class={inputClass(errors.pixKey)}
          />
        </Field>

        <div class="sm:col-span-2">
          <Field
            label="Default PDF filename template"
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
            />
          </Field>
        </div>

        <div class="sm:col-span-2">
          <Field
            label="Bank / payment details"
            name="bankDetails"
            error={errors.bankDetails}
          >
            <textarea
              id="bankDetails"
              name="bankDetails"
              rows={3}
              class={textareaClass(errors.bankDetails)}
            >
              {values.bankDetails}
            </textarea>
          </Field>
        </div>

        <div class="sm:col-span-2 flex justify-end">
          <button type="submit" class="btn btn-primary">
            Save settings
          </button>
        </div>
      </form>
    </div>
  );
}
