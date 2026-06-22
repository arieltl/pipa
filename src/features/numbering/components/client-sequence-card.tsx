import type { Client } from "../../../db/schema.ts";
import { Field, SubmitButton, inputClass, type FieldErrors } from "../../../web/components/forms.tsx";
import type { NumberingPreview } from "../numbering.service.ts";

export function ClientSequenceCard({
  client,
  preview,
  invoiceDate,
  errors = {},
  saved,
}: {
  client: Client;
  preview: NumberingPreview | null;
  invoiceDate: string;
  errors?: FieldErrors;
  saved?: boolean;
}) {
  if (!preview) {
    return (
      <div class="app-card lift-enter max-w-3xl rounded-lg p-6">
        <h2 class="text-base font-semibold">Numbering sequence</h2>
        <p class="mt-2 text-sm text-base-content/65">
          Choose a numbering profile above, save the client, then set the next
          sequence for migration or catch-up.
        </p>
      </div>
    );
  }

  return (
    <div id="client-sequence-card" class="app-card lift-enter max-w-3xl rounded-lg p-6">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 class="text-base font-semibold">Numbering sequence</h2>
          <p class="mt-1 text-sm text-base-content/65">
            Set the next sequence for this client/profile/period.
          </p>
        </div>
        {saved ? (
          <span class="badge badge-success badge-sm">Sequence saved</span>
        ) : null}
      </div>

      <dl class="mt-4 grid gap-3 sm:grid-cols-3">
        <SequenceFact label="Profile" value={preview.profile.name} />
        <SequenceFact label="Period" value={preview.periodKey} />
        <SequenceFact label="Next invoice" value={preview.number} mono />
      </dl>

      {!preview.hasSequence ? (
        <div class="alert alert-warning mt-4 py-2 text-sm">
          <span>This profile has no sequence token, so sequence changes will not affect its number.</span>
        </div>
      ) : null}

      <form
        class="app-form mt-5 grid gap-4 sm:grid-cols-[1fr_1fr_auto]"
        hx-post={`/clients/${client.id}/numbering-sequence`}
        hx-target="#client-sequence-card"
        hx-swap="outerHTML"
      >
        <Field label="Period date" name="invoiceDate" error={errors.invoiceDate}>
          <input
            id="invoiceDate"
            name="invoiceDate"
            type="date"
            value={invoiceDate}
            class={inputClass(errors.invoiceDate)}
          />
        </Field>
        <Field label="Next sequence" name="nextSeq" error={errors.nextSeq}>
          <input
            id="nextSeq"
            name="nextSeq"
            type="number"
            min="1"
            step="1"
            value={String(preview.nextSeq)}
            class={inputClass(errors.nextSeq)}
          />
        </Field>
        <div class="flex items-end">
          <SubmitButton label="Set sequence" size="sm" />
        </div>
      </form>
    </div>
  );
}

function SequenceFact({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div class="rounded-lg border border-base-300 bg-base-200/35 p-3">
      <dt class="text-xs font-medium uppercase tracking-wide text-base-content/45">
        {label}
      </dt>
      <dd class={`mt-1 truncate text-sm font-semibold ${mono ? "font-mono" : ""}`}>
        {value}
      </dd>
    </div>
  );
}
