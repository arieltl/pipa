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
import type { PartyField } from "../../../domain/party-fields/index.ts";
import { PartyFieldEditor } from "../../../web/components/party-field-editor.tsx";
import type { PdfTemplate } from "../../../db/schema.ts";

export type IssuerFormValues = {
  name: string;
  defaultCurrency: string;
  defaultPdfFilenameTemplate: string;
  defaultPdfTemplateId: string;
  partyFields: PartyField[];
};

export type IssuerFormProps = {
  values: IssuerFormValues;
  errors?: FieldErrors;
  saved?: boolean;
  pdfTemplates: PdfTemplate[];
};

/**
 * Issuer settings form. Submits via htmx and swaps itself (outerHTML), so the
 * same fragment renders the empty form, validation errors (422), and the
 * saved-confirmation state.
 */
export function IssuerForm({ values, errors = {}, saved, pdfTemplates }: IssuerFormProps) {
  return (
    <div id="issuer-form">
      {saved ? <Alert kind="success" message="Issuer settings saved." /> : null}

      <form
        hx-post="/settings/issuer"
        hx-target="#issuer-form"
        hx-swap="outerHTML"
        x-data="enhancedForm"
        class="app-form max-w-5xl space-y-4"
      >
        <section class="app-card grid gap-4 rounded-lg p-5 sm:grid-cols-2">
        <div class="sm:col-span-2"><h2 class="font-semibold">Issuer</h2><p class="text-xs text-base-content/50">Application identity and currency.</p></div>
        <div>
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
        </section>

        <PartyFieldEditor fields={values.partyFields} error={errors.partyFields} />

        <section class="app-card rounded-lg p-5">
          <h2 class="mb-4 font-semibold">Document defaults</h2>
          <div class="mb-4">
            <Field
              label="Default invoice template"
              name="defaultPdfTemplateId"
              hint="Used when a client does not choose its own default. HTML options require configured Gotenberg."
              error={errors.defaultPdfTemplateId}
            >
              <select
                id="defaultPdfTemplateId"
                name="defaultPdfTemplateId"
                class={selectClass(errors.defaultPdfTemplateId)}
              >
                <option value="">Built-in fallback</option>
                {pdfTemplates.map((template) => (
                  <option
                    value={String(template.id)}
                    selected={values.defaultPdfTemplateId === String(template.id)}
                  >
                    {template.name} ({template.engine === "react-pdf" ? "React PDF" : "HTML"})
                  </option>
                ))}
              </select>
            </Field>
          </div>
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
        </section>

        <div class="flex justify-end px-1">
          <SubmitButton label="Save settings" />
        </div>
      </form>
    </div>
  );
}
