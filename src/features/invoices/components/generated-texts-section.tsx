import type {
  ClientTextGenerator,
  InvoiceGeneratedText,
} from "../../../db/schema.ts";
import {
  Alert,
  SubmitButton,
  textareaClass,
} from "../../../web/components/forms.tsx";
import { Icon } from "../../../web/components/icons.tsx";

export function GeneratedTextsSection({
  invoiceId,
  generators,
  savedTexts,
}: {
  invoiceId: number;
  generators: ClientTextGenerator[];
  savedTexts: InvoiceGeneratedText[];
}) {
  const custom = generators.filter((generator) => generator.purpose === "custom");
  if (!custom.length) return null;
  return (
    <section>
      <h2 class="mb-2 text-sm font-semibold uppercase tracking-wide text-base-content/55">
        Generated text
      </h2>
      <div class="grid gap-3">
        {custom.map((generator) => (
          <GeneratedTextCard
            invoiceId={invoiceId}
            generator={generator}
            value={
              savedTexts.find((text) => text.generatorKey === generator.key)?.content ?? ""
            }
            sourceSnapshot={
              savedTexts.find((text) => text.generatorKey === generator.key)?.sourceSnapshot ??
              generator.source
            }
          />
        ))}
      </div>
    </section>
  );
}

export function GeneratedTextCard({
  invoiceId,
  generator,
  value,
  saved,
  generated,
  error,
  sourceSnapshot,
}: {
  invoiceId: number;
  generator: ClientTextGenerator;
  value: string;
  saved?: boolean;
  generated?: boolean;
  error?: string;
  sourceSnapshot?: string;
}) {
  const id = `invoice-generated-${generator.key}`;
  return (
    <article id={id} class="app-card rounded-lg p-5" x-data="{ copied: false }" data-dirty-section>
      <div class="mb-3">
        <h3 class="font-semibold">{generator.name}</h3>
        <code class="text-xs text-base-content/45">{generator.key}</code>
      </div>
      {saved ? <Alert kind="success" message="Generated text saved." /> : null}
      {error ? <Alert kind="error" message={error} /> : null}
      {generated ? (
        <p class="mb-3 text-sm text-info">
          Generated from the template — review and save to store it.
        </p>
      ) : null}
      <form
        hx-post={`/invoices/${invoiceId}/generated-texts/${generator.key}`}
        hx-target={`#${id}`}
        hx-swap="outerHTML"
        x-data="enhancedForm"
      >
        <input type="hidden" name="sourceSnapshot" value={sourceSnapshot ?? generator.source} />
        <textarea
          name="content"
          x-ref="generatedText"
          rows={5}
          maxlength={100000}
          class={textareaClass()}
          placeholder="Generate from the template, or write text here."
        >{value}</textarea>
        <div class="mt-3 grid grid-cols-2 gap-2">
          <span data-dirty-badge class="col-span-2">Unsaved changes</span>
          <button
            type="button"
            class="btn btn-ghost btn-sm col-span-2"
            hx-post={`/invoices/${invoiceId}/generated-texts/${generator.key}/generate`}
            hx-target={`#${id}`}
            hx-swap="outerHTML"
            hx-confirm="Replace the current text with a freshly generated version?"
          >
            <Icon name="refresh" />
            {value.trim() ? "Regenerate" : "Generate"}
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            x-on:click="navigator.clipboard.writeText($refs.generatedText.value); copied = true; setTimeout(() => copied = false, 1500)"
          >
            <Icon name="copy" />
            <span x-text="copied ? 'Copied!' : 'Copy'">Copy</span>
          </button>
          <SubmitButton label="Save" size="sm" className="w-full" />
        </div>
      </form>
    </article>
  );
}
