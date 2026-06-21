import type { NotaFiscalLink } from "../../../db/schema.ts";
import {
  Alert,
  Field,
  SubmitButton,
  inputClass,
  textareaClass,
  type FieldErrors,
} from "../../../web/components/forms.tsx";

export type NfseLinkValues = {
  nfNumber: string;
  issueDate: string;
  verificationCode: string;
  publicUrl: string;
  notes: string;
};

export type NfseLinkSectionProps = {
  invoiceId: number;
  link: NotaFiscalLink | null;
  values?: NfseLinkValues;
  errors?: FieldErrors;
  saved?: boolean;
  /** Show the default-checked "mark as sent" toggle (first link from issued). */
  offerMarkSent?: boolean;
};

export function nfseLinkValuesFromLink(
  link: NotaFiscalLink | null,
): NfseLinkValues {
  return {
    nfNumber: link?.nfNumber ?? "",
    issueDate: link?.issueDate ?? "",
    verificationCode: link?.verificationCode ?? "",
    publicUrl: link?.publicUrl ?? "",
    notes: link?.notes ?? "",
  };
}

/**
 * Link/edit Brazilian nota fiscal / NFS-e metadata for an invoice (spec §16),
 * with optional PDF/XML uploads. Submits as multipart; the whole section is
 * swapped on save. Uploaded files supersede prior attachments server-side.
 */
export function NfseLinkSection({
  invoiceId,
  link,
  values,
  errors,
  saved,
  offerMarkSent,
}: NfseLinkSectionProps) {
  const v = values ?? nfseLinkValuesFromLink(link);
  const pdfFileId = link?.pdfFileId ?? null;
  const xmlFileId = link?.xmlFileId ?? null;
  return (
    <div
      id="invoice-nfse-link"
      class="app-card rounded-lg p-5"
    >
      {saved ? (
        <Alert kind="success" message="Nota fiscal link saved." />
      ) : null}

      <form
        hx-post={`/invoices/${invoiceId}/nfse-link`}
        hx-target="#invoice-nfse-link"
        hx-swap="outerHTML"
        hx-encoding="multipart/form-data"
        x-data="enhancedForm"
        class="app-form grid sm:grid-cols-2"
      >
        <Field label="NFS-e number" name="nfNumber" error={errors?.nfNumber}>
          <input
            type="text"
            id="nfNumber"
            name="nfNumber"
            value={v.nfNumber}
            class={inputClass(errors?.nfNumber)}
            maxlength={120}
            data-format="trim"
          />
        </Field>
        <Field label="Issue date" name="issueDate" error={errors?.issueDate}>
          <input
            type="date"
            id="issueDate"
            name="issueDate"
            value={v.issueDate}
            class={inputClass(errors?.issueDate)}
          />
        </Field>
        <Field
          label="Verification code"
          name="verificationCode"
          error={errors?.verificationCode}
        >
          <input
            type="text"
            id="verificationCode"
            name="verificationCode"
            value={v.verificationCode}
            class={inputClass(errors?.verificationCode)}
            maxlength={200}
            data-format="trim"
          />
        </Field>
        <Field label="Public URL" name="publicUrl" error={errors?.publicUrl}>
          <input
            type="url"
            id="publicUrl"
            name="publicUrl"
            value={v.publicUrl}
            class={inputClass(errors?.publicUrl)}
            maxlength={2000}
            placeholder="https://..."
            data-format="trim"
          />
        </Field>

        <div class="sm:col-span-2">
          <Field label="Notes" name="notes" error={errors?.notes}>
            <textarea
              id="notes"
              name="notes"
              rows={2}
              class={textareaClass(errors?.notes)}
              maxlength={2000}
              data-format="trim"
            >
              {v.notes}
            </textarea>
          </Field>
        </div>

        <Field
          label="NFS-e PDF"
          name="pdf"
          hint={pdfFileId ? "Uploading replaces the current PDF." : "Optional."}
        >
          <input
            type="file"
            id="pdf"
            name="pdf"
            accept="application/pdf,.pdf"
            class="app-control file-input file-input-bordered w-full"
          />
        </Field>
        <Field
          label="NFS-e XML"
          name="xml"
          hint={xmlFileId ? "Uploading replaces the current XML." : "Optional."}
        >
          <input
            type="file"
            id="xml"
            name="xml"
            accept="application/xml,text/xml,.xml"
            class="app-control file-input file-input-bordered w-full"
          />
        </Field>

        {pdfFileId || xmlFileId ? (
          <div class="sm:col-span-2 flex flex-wrap gap-2 text-sm">
            {pdfFileId ? (
              <a
                href={`/invoices/${invoiceId}/files/${pdfFileId}`}
                class="btn btn-ghost btn-xs"
              >
                Download PDF
              </a>
            ) : null}
            {xmlFileId ? (
              <a
                href={`/invoices/${invoiceId}/files/${xmlFileId}`}
                class="btn btn-ghost btn-xs"
              >
                Download XML
              </a>
            ) : null}
          </div>
        ) : null}

        {offerMarkSent ? (
          <label class="sm:col-span-2 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="markSent"
              checked
              class="checkbox checkbox-sm"
            />
            <span>Mark invoice as sent once the NFS-e is linked</span>
          </label>
        ) : null}

        <div class="sm:col-span-2 flex justify-end">
          <SubmitButton label="Save link" size="sm" />
        </div>
      </form>
    </div>
  );
}
