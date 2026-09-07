import type { ClientTextGenerator } from "../../../db/schema.ts";
import {
  Alert,
  Field,
  inputClass,
  selectClass,
  textareaClass,
  type FieldErrors,
} from "../../../web/components/forms.tsx";

export type TextGeneratorValues = {
  name: string;
  key: string;
  purpose: "nfse-description" | "custom";
  source: string;
};

const emptyValues: TextGeneratorValues = {
  name: "",
  key: "",
  purpose: "custom",
  source: "",
};

export function TextGeneratorsSection({
  clientId,
  generators,
  editor,
  errors = {},
  submittedValues,
  saved,
}: {
  clientId: number;
  generators: ClientTextGenerator[];
  editor?: "new" | number;
  errors?: FieldErrors;
  submittedValues?: TextGeneratorValues;
  saved?: string;
}) {
  const active = generators.filter((generator) => !generator.archivedAt);
  const archived = generators.filter((generator) => generator.archivedAt);

  return (
    <section
      id="client-text-generators"
      class="mt-6"
      x-data={`{ newOpen: ${editor === "new" ? "true" : "false"} }`}
    >
      <div class="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 class="text-lg font-semibold">Text generators</h2>
          <p class="text-sm text-base-content/55">
            Create editable invoice text from Liquid templates. Each generator
            belongs only to this client.
          </p>
        </div>
        <button
          type="button"
          class="btn btn-primary btn-sm"
          x-on:click="newOpen = true; $nextTick(() => $refs.newGeneratorName.focus())"
        >
          Add generator
        </button>
      </div>

      {saved ? <Alert kind="success" message={saved} /> : null}

      <div class="grid gap-4">
        {active.map((generator) => (
          <GeneratorCard
            clientId={clientId}
            generator={generator}
            open={editor === generator.id}
            values={editor === generator.id && submittedValues ? submittedValues : valuesFromGenerator(generator)}
            errors={editor === generator.id ? errors : {}}
          />
        ))}

        {active.length === 0 ? (
          <div class="app-card rounded-xl p-5 text-sm text-base-content/55">
            No text generators yet. Add one for NFS-e descriptions, email copy,
            payment references, or any other invoice-derived text.
          </div>
        ) : null}

        <div
          class="app-card rounded-xl p-5"
        >
          <button
            type="button"
            class="flex w-full items-center justify-between text-left"
            x-on:click="newOpen = !newOpen"
          >
            <span class="font-semibold">New text generator</span>
            <span class="text-base-content/45" x-text="newOpen ? '−' : '+'">+</span>
          </button>
          <div x-show="newOpen" class="mt-4" style={editor === "new" ? "" : "display:none"}>
            <GeneratorForm
              action={`/clients/${clientId}/text-generators`}
              values={editor === "new" && submittedValues ? submittedValues : emptyValues}
              errors={editor === "new" ? errors : {}}
              nameRef="newGeneratorName"
              submitLabel="Create generator"
            />
          </div>
        </div>

        {archived.length ? (
          <details class="app-card rounded-xl p-5">
            <summary class="cursor-pointer text-sm font-medium text-base-content/65">
              Archived generators ({archived.length})
            </summary>
            <ul class="mt-3 grid gap-2 text-sm text-base-content/55">
              {archived.map((generator) => (
                <li class="flex justify-between gap-4 border-t border-base-300/50 pt-2">
                  <span>{generator.name}</span>
                  <code>{generator.key}</code>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </section>
  );
}

function GeneratorCard({
  clientId,
  generator,
  values,
  errors,
  open,
}: {
  clientId: number;
  generator: ClientTextGenerator;
  values: TextGeneratorValues;
  errors: FieldErrors;
  open: boolean;
}) {
  return (
    <article class="app-card rounded-xl p-5" x-data={`{ open: ${open ? "true" : "false"} }`}>
      <div class="flex flex-wrap items-start justify-between gap-3">
        <button type="button" class="min-w-0 text-left" x-on:click="open = !open">
          <span class="block font-semibold">{generator.name}</span>
          <span class="mt-1 flex flex-wrap items-center gap-2 text-xs text-base-content/50">
            <code>{generator.key}</code>
            <span class="badge badge-outline badge-sm">
              {generator.purpose === "nfse-description" ? "NFS-e description" : "Custom"}
            </span>
          </span>
        </button>
        <div class="flex gap-2">
          <button type="button" class="btn btn-ghost btn-sm" x-on:click="open = !open">
            Edit
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-sm text-error"
            hx-delete={`/clients/${clientId}/text-generators/${generator.id}`}
            hx-target="#client-text-generators"
            hx-swap="outerHTML"
            hx-confirm={`Archive “${generator.name}”? Saved invoice text will be kept.`}
          >
            Archive
          </button>
        </div>
      </div>
      <div x-show="open" class="mt-4" style={open ? "" : "display:none"}>
        <GeneratorForm
          action={`/clients/${clientId}/text-generators/${generator.id}`}
          values={values}
          errors={errors}
          submitLabel="Save generator"
          lockKey
        />
      </div>
    </article>
  );
}

function GeneratorForm({
  action,
  values,
  errors,
  submitLabel,
  nameRef,
  lockKey,
}: {
  action: string;
  values: TextGeneratorValues;
  errors: FieldErrors;
  submitLabel: string;
  nameRef?: string;
  lockKey?: boolean;
}) {
  return (
    <form
      hx-post={action}
      hx-target="#client-text-generators"
      hx-swap="outerHTML"
      class="grid gap-4 sm:grid-cols-2"
    >
      {errors._form ? <div class="sm:col-span-2"><Alert kind="error" message={errors._form} /></div> : null}
      <Field label="Name" name="name" required error={errors.name}>
        <input
          name="name"
          x-ref={nameRef}
          value={values.name}
          maxlength={120}
          class={inputClass(errors.name)}
        />
      </Field>
      <Field
        label="Stable key"
        name="key"
        required
        hint={lockKey ? "Keys stay fixed so saved invoice output remains linked." : "Lower-case letters, numbers, and underscores. Keep this stable after use."}
        error={errors.key}
      >
        <input name="key" value={values.key} maxlength={64} readonly={lockKey} class={inputClass(errors.key)} />
      </Field>
      <div class="sm:col-span-2">
        <Field
          label="Purpose"
          name="purpose"
          hint="NFS-e description appears in the dedicated NFS-e workflow."
          error={errors.purpose}
        >
          <select name="purpose" class={selectClass(errors.purpose)}>
            <option value="custom" selected={values.purpose === "custom"}>Custom text</option>
            <option value="nfse-description" selected={values.purpose === "nfse-description"}>NFS-e description</option>
          </select>
        </Field>
      </div>
      <div class="sm:col-span-2">
        <Field
          label="Liquid template"
          name="source"
          required
          hint="Examples: {{ invoice.number }}, {{ invoice.dateDisplay }}, {{ customer.name }}, {{ total.decimal }}. You can also use Liquid if/for tags."
          error={errors.source}
        >
          <textarea
            name="source"
            rows={7}
            maxlength={20000}
            class={`${textareaClass(errors.source)} font-mono text-sm`}
          >{values.source}</textarea>
        </Field>
      </div>
      <div class="sm:col-span-2 flex justify-end">
        <button type="submit" class="btn btn-primary btn-sm">{submitLabel}</button>
      </div>
    </form>
  );
}

function valuesFromGenerator(generator: ClientTextGenerator): TextGeneratorValues {
  return {
    name: generator.name,
    key: generator.key,
    purpose: generator.purpose === "nfse-description" ? "nfse-description" : "custom",
    source: generator.source,
  };
}
