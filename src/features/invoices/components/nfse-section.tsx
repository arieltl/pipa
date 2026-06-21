import {
  Alert,
  SubmitButton,
  textareaClass,
} from "../../../web/components/forms.tsx";

export type NfseSectionProps = {
  invoiceId: number;
  /** Current text shown in the editor (saved value or freshly generated). */
  value: string;
  /** Whether the client has a nota fiscal template to generate from. */
  hasTemplate: boolean;
  /** Show the "saved" confirmation banner. */
  saved?: boolean;
  /** Text was just generated from the template but not yet saved. */
  generated?: boolean;
};

/**
 * Editable nota fiscal / NFS-e description (spec §12). Generation renders the
 * client template server-side (htmx); editing, saving, and copying are local.
 * The saved text is a snapshot — later template changes never mutate it.
 */
export function NfseSection({
  invoiceId,
  value,
  hasTemplate,
  saved,
  generated,
}: NfseSectionProps) {
  const generateLabel = value.trim() === "" ? "Generate from template" : "Regenerate";
  return (
    <div id="invoice-nfse" x-data="{ copied: false }" data-dirty-section>
      {saved ? (
        <Alert kind="success" message="Nota fiscal description saved." />
      ) : null}
      {generated ? (
        <div class="mb-3 text-sm text-info">
          Generated from the template — review and click Save to store it.
        </div>
      ) : null}

      <form
        hx-post={`/invoices/${invoiceId}/nfse`}
        hx-target="#invoice-nfse"
        hx-swap="outerHTML"
        x-data="enhancedForm"
      >
        <textarea
          name="nfseDescription"
          x-ref="nfse"
          rows={5}
          class={textareaClass()}
          placeholder="Generate from the client's template, or write the description here."
          maxlength={2000}
          data-format="trim"
        >
          {value}
        </textarea>

        <div class="mt-3 flex flex-wrap items-center justify-end gap-2">
          <span data-dirty-badge class="mr-auto">Unsaved changes</span>
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            hx-post={`/invoices/${invoiceId}/nfse/generate`}
            hx-target="#invoice-nfse"
            hx-swap="outerHTML"
            hx-confirm="Replace the current text with a freshly generated version?"
          >
            {generateLabel}
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            x-on:click="navigator.clipboard.writeText($refs.nfse.value); copied = true; setTimeout(() => copied = false, 1500)"
          >
            <span x-text="copied ? 'Copied!' : 'Copy'">Copy</span>
          </button>
          <SubmitButton label="Save" size="sm" />
        </div>
      </form>

      {!hasTemplate ? (
        <p class="mt-2 text-sm text-base-content/50">
          This client has no nota fiscal template.{" "}
          <a href={`/clients`} class="link link-hover">
            Add one
          </a>{" "}
          to generate text automatically.
        </p>
      ) : null}
    </div>
  );
}
