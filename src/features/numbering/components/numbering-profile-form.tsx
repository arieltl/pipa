import {
  Alert,
  Field,
  SubmitButton,
  inputClass,
  selectClass,
  type FieldErrors,
} from "../../../web/components/forms.tsx";
import { resetPeriods } from "../../../domain/numbering.ts";
import type { NumberingProfileFormValues } from "../numbering.view.ts";

export function NumberingProfileForm({
  action,
  values,
  errors = {},
  submitLabel,
  saved,
}: {
  action: string;
  values: NumberingProfileFormValues;
  errors?: FieldErrors;
  submitLabel: string;
  saved?: boolean;
}) {
  return (
    <div id="numbering-profile-form">
      {saved ? <Alert kind="success" message="Numbering profile saved." /> : null}
      <form
        hx-post={action}
        hx-target="#numbering-profile-form"
        hx-swap="outerHTML"
        x-data="enhancedForm"
        data-dirty-section
        class="app-form"
      >
        <Field label="Name" name="name" required error={errors.name}>
          <input
            id="name"
            name="name"
            type="text"
            value={values.name}
            class={inputClass(errors.name)}
            maxlength={120}
            required
            data-format="trim"
          />
        </Field>

        <Field
          label="Pattern"
          name="pattern"
          required
          hint="Tokens: {CLIENT_CODE}, {YYYY}, {YY}, {MM}, {DD}, {YYYYMM}, {SEQ}, {SEQ:02}, {SEQ:03}, {SEQ:04}"
          error={errors.pattern}
        >
          <input
            id="pattern"
            name="pattern"
            type="text"
            value={values.pattern}
            class={`${inputClass(errors.pattern)} font-mono`}
            maxlength={200}
            required
            data-format="trim"
          />
        </Field>

        <Field
          label="Sequence reset period"
          name="resetPeriod"
          required
          error={errors.resetPeriod}
        >
          <select
            id="resetPeriod"
            name="resetPeriod"
            class={selectClass(errors.resetPeriod)}
          >
            {resetPeriods().map((period) => (
              <option value={period} selected={values.resetPeriod === period}>
                {period}
              </option>
            ))}
          </select>
        </Field>

        <div class="rounded-lg border border-base-300 bg-base-200/45 p-3 text-xs leading-relaxed text-base-content/65">
          Padding is a minimum width: <span class="font-mono">{`{SEQ:04}`}</span>{" "}
          renders 0007 for sequence 7, but sequence 10000 still renders 10000.
        </div>

        <div class="flex items-center justify-end gap-2">
          <span data-dirty-badge class="mr-auto">Unsaved changes</span>
          <a href="/settings/numbering" class="btn btn-ghost">
            Cancel
          </a>
          <SubmitButton label={submitLabel} />
        </div>
      </form>
    </div>
  );
}
