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
import type { NumberingProfile, PdfTemplate } from "../../../db/schema.ts";
import type { PartyField } from "../../../domain/party-fields/index.ts";
import { PartyFieldEditor } from "../../../web/components/party-field-editor.tsx";

export type ClientFormValues = {
  name: string;
  code: string;
  defaultCurrency: string;
  defaultFixedMonthlyValue: string;
  defaultFixedMonthlyItemNameTemplate: string;
  defaultPdfFilenameTemplate: string;
  numberingProfileId: string;
  defaultPdfTemplateId: string;
  isDefault: boolean;
  partyFields: PartyField[];
};

export type ClientFormProps = {
  /** POST target: /clients for create, /clients/:id for update. */
  action: string;
  values: ClientFormValues;
  profiles: NumberingProfile[];
  pdfTemplates: PdfTemplate[];
  errors?: FieldErrors;
  submitLabel: string;
  saved?: boolean;
};

export function ClientForm({
  action,
  values,
  profiles,
  pdfTemplates,
  errors = {},
  submitLabel,
  saved,
}: ClientFormProps) {
  return (
    <div id="client-form" >
      {saved ? <Alert kind="success" message="Client saved." /> : null}

      <form
        id="client-details-form"
        hx-post={action}
        hx-target="#client-form"
        hx-swap="outerHTML"
        x-data="enhancedForm"
        data-dirty-section
        class="app-form client-settings-form space-y-4"
        {...{"x-on:invalid.capture": "workspace = $event.target.closest('[data-panel]')?.dataset.panel || workspace"}}
      >
        {action === "/clients" ? <input type="hidden" name="configureSection" x-bind:value="workspace" /> : null}
        {Object.keys(errors).length ? <Alert kind="error" message="Please review the highlighted fields. Select the section with the highlighted field before saving." /> : null}
        <section data-panel="overview" x-show="workspace === 'overview'" class="app-card grid gap-5 rounded-xl p-6 sm:grid-cols-2">
        <div class="sm:col-span-2"><h2 class="font-semibold">Client</h2><p class="text-xs text-base-content/50">Application identity and defaults.</p></div>
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
            pattern="[A-Za-z0-9_\-]+"
            title="Use letters, numbers, dashes, or underscores."
            data-format="upper"
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
          <label class="flex cursor-pointer items-start gap-3 rounded-lg border border-base-300 p-4 transition hover:border-primary/30">
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
        </section>

        <div data-panel="details" x-show="workspace === 'details'" x-cloak><PartyFieldEditor fields={values.partyFields} error={errors.partyFields} /></div>

        <section data-panel="billing" x-show="workspace === 'billing'" x-cloak class="app-card grid gap-5 rounded-xl p-6 sm:grid-cols-2">
        <div class="sm:col-span-2"><h2 class="font-semibold">Invoice defaults</h2><p class="text-xs text-base-content/50">Copied into new invoices and always editable there.</p></div>
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

        </section>
        <section data-panel="numbering" x-show="workspace === 'numbering'" x-cloak class="app-card grid gap-5 rounded-xl p-6">
          <div><h2 class="font-semibold">Numbering</h2><p class="text-xs text-base-content/50">Choose how invoice numbers are assigned for this client.</p></div>
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
          <p class="text-xs text-base-content/50">{action === "/clients" ? "Create this client to preview and manage its live sequence." : "Save a profile change before adjusting the sequence below."}</p>
        </section>
        <section data-panel="pdf" x-show="workspace === 'pdf'" x-cloak class="app-card grid gap-5 rounded-xl p-6 sm:grid-cols-2">
          <div class="sm:col-span-2"><h2 class="font-semibold">PDF appearance</h2><p class="text-xs text-base-content/50">Choose the invoice design and download filename.</p></div>
        <div class="sm:col-span-2">
          <Field
            label="Default invoice template"
            name="defaultPdfTemplateId"
            hint="New invoices snapshot the current revision. Leave inherited to use the issuer default. HTML options require configured Gotenberg."
            error={errors.defaultPdfTemplateId}
          >
            <select
              id="defaultPdfTemplateId"
              name="defaultPdfTemplateId"
              class={selectClass(errors.defaultPdfTemplateId)}
            >
              <option value="">Use issuer default</option>
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


        </section>

        <div x-show="!['text', 'records'].includes(workspace)" class="client-save-bar flex items-center justify-end gap-2">
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
