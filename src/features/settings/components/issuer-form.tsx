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

export type IssuerFormValues = {
  name: string;
  legalName: string;
  cnpj: string;
  address: string;
  email: string;
  bankBeneficiary: string;
  bankBeneficiaryAddress: string;
  bankIban: string;
  bankSwiftCode: string;
  bankName: string;
  bankAddress: string;
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
        x-data="enhancedForm"
        class="app-form grid sm:grid-cols-2"
      >
        <div class="sm:col-span-2">
          <Field label="Issuer name" name="name" required error={errors.name}>
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
        </div>

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

        <Field label="CNPJ" name="cnpj" error={errors.cnpj}>
          <input
            id="cnpj"
            name="cnpj"
            type="text"
            value={values.cnpj}
            class={inputClass(errors.cnpj)}
            inputmode="numeric"
            maxlength={18}
            pattern="^\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}$"
            title="Use CNPJ format 00.000.000/0000-00."
            data-format="cnpj"
          />
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

        <Field label="Email" name="email" error={errors.email}>
          <input
            id="email"
            name="email"
            type="email"
            value={values.email}
            class={inputClass(errors.email)}
            maxlength={254}
            autocomplete="email"
            placeholder="name@example.com"
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

        <div class="sm:col-span-2 border-t border-base-content/10 pt-5">
          <div class="text-sm font-semibold text-base-content/80">
            Bank payment details
          </div>
        </div>

        <Field
          label="Beneficiary"
          name="bankBeneficiary"
          error={errors.bankBeneficiary}
        >
          <input
            id="bankBeneficiary"
            name="bankBeneficiary"
            type="text"
            value={values.bankBeneficiary}
            class={inputClass(errors.bankBeneficiary)}
            maxlength={200}
            data-format="trim"
          />
        </Field>

        <Field label="Bank name" name="bankName" error={errors.bankName}>
          <input
            id="bankName"
            name="bankName"
            type="text"
            value={values.bankName}
            class={inputClass(errors.bankName)}
            maxlength={200}
            data-format="trim"
          />
        </Field>

        <Field
          label="Account Number (IBAN)"
          name="bankIban"
          error={errors.bankIban}
        >
          <input
            id="bankIban"
            name="bankIban"
            type="text"
            value={values.bankIban}
            class={inputClass(errors.bankIban)}
            maxlength={200}
            data-format="trim"
          />
        </Field>

        <Field
          label="SWIFT / BIC"
          name="bankSwiftCode"
          error={errors.bankSwiftCode}
        >
          <input
            id="bankSwiftCode"
            name="bankSwiftCode"
            type="text"
            value={values.bankSwiftCode}
            class={inputClass(errors.bankSwiftCode)}
            maxlength={100}
            data-format="trim"
          />
        </Field>

        <Field label="PIX key" name="pixKey" error={errors.pixKey}>
          <input
            id="pixKey"
            name="pixKey"
            type="text"
            value={values.pixKey}
            class={inputClass(errors.pixKey)}
            maxlength={200}
            data-format="trim"
          />
        </Field>

        <div class="sm:col-span-2">
          <Field
            label="Beneficiary address"
            name="bankBeneficiaryAddress"
            error={errors.bankBeneficiaryAddress}
          >
            <textarea
              id="bankBeneficiaryAddress"
              name="bankBeneficiaryAddress"
              rows={2}
              class={textareaClass(errors.bankBeneficiaryAddress)}
              maxlength={1000}
              data-format="trim"
            >
              {values.bankBeneficiaryAddress}
            </textarea>
          </Field>
        </div>

        <div class="sm:col-span-2">
          <Field
            label="Bank address"
            name="bankAddress"
            error={errors.bankAddress}
          >
            <textarea
              id="bankAddress"
              name="bankAddress"
              rows={2}
              class={textareaClass(errors.bankAddress)}
              maxlength={1000}
              data-format="trim"
            >
              {values.bankAddress}
            </textarea>
          </Field>
        </div>

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
              maxlength={300}
              data-format="trim"
            />
          </Field>
        </div>

        <div class="sm:col-span-2">
          <Field
            label="Additional payment notes"
            name="bankDetails"
            error={errors.bankDetails}
          >
            <textarea
              id="bankDetails"
              name="bankDetails"
              rows={3}
              class={textareaClass(errors.bankDetails)}
              maxlength={2000}
              data-format="trim"
            >
              {values.bankDetails}
            </textarea>
          </Field>
        </div>

        <div class="sm:col-span-2 flex justify-end">
          <SubmitButton label="Save settings" />
        </div>
      </form>
    </div>
  );
}
