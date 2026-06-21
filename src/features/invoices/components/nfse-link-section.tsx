import type { FileRecord, NotaFiscalLink } from "../../../db/schema.ts";
import {
  Alert,
  Field,
  SubmitButton,
  inputClass,
  textareaClass,
  type FieldErrors,
} from "../../../web/components/forms.tsx";
import { Icon } from "../../../web/components/icons.tsx";

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
  uploadedPdf?: boolean;
  uploadedXml?: boolean;
  removedPdf?: boolean;
  removedXml?: boolean;
  pdfFile?: FileRecord | null;
  xmlFile?: FileRecord | null;
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
  uploadedPdf,
  uploadedXml,
  removedPdf,
  removedXml,
  pdfFile,
  xmlFile,
  offerMarkSent,
}: NfseLinkSectionProps) {
  const v = values ?? nfseLinkValuesFromLink(link);
  const pdfFileId = pdfFile?.id ?? link?.pdfFileId ?? null;
  const xmlFileId = xmlFile?.id ?? link?.xmlFileId ?? null;
  const savedMessage = [
    "NFS-e link saved.",
    uploadedPdf ? "PDF uploaded." : "",
    uploadedXml ? "XML uploaded." : "",
    removedPdf ? "PDF unlinked." : "",
    removedXml ? "XML unlinked." : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div
      id="invoice-nfse-link"
      class="app-card rounded-lg p-5"
      x-data="{ pdfName: '', xmlName: '' }"
      data-dirty-section
    >
      {saved ? (
        <Alert kind="success" message={savedMessage} />
      ) : null}

      <form
        hx-post={`/invoices/${invoiceId}/nfse-link`}
        hx-target="#invoice-nfse-link"
        hx-swap="outerHTML"
        hx-encoding="multipart/form-data"
        x-data="enhancedForm"
        class="grid gap-3"
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

        <div class="grid gap-2">
          <div class="text-xs font-semibold uppercase tracking-wide text-base-content/45">
            Linked files
          </div>
          <FileAttachmentControl
            invoiceId={invoiceId}
            inputId="nfse-pdf-upload"
            name="pdf"
            label="PDF"
            accept="application/pdf,.pdf"
            selectedName="pdfName"
            fileId={pdfFileId}
            file={pdfFile}
            justUploaded={uploadedPdf}
            removePath={`/invoices/${invoiceId}/nfse-link/pdf`}
          />
          <FileAttachmentControl
            invoiceId={invoiceId}
            inputId="nfse-xml-upload"
            name="xml"
            label="XML"
            accept="application/xml,text/xml,.xml"
            selectedName="xmlName"
            fileId={xmlFileId}
            file={xmlFile}
            justUploaded={uploadedXml}
            removePath={`/invoices/${invoiceId}/nfse-link/xml`}
          />
        </div>

        <div class="-mt-1 grid gap-2">
          <span data-dirty-badge>Unsaved NFS-e changes</span>
        </div>

        {offerMarkSent ? (
          <label class="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="markSent"
              checked
              class="checkbox checkbox-sm"
            />
            <span>Mark invoice as sent once the NFS-e is linked</span>
          </label>
        ) : null}

        <div class="flex justify-end">
          <SubmitButton label="Save link" size="sm" className="w-full" />
        </div>
      </form>
    </div>
  );
}

function FileAttachmentControl({
  invoiceId,
  inputId,
  name,
  fileId,
  label,
  accept,
  selectedName,
  file,
  justUploaded,
  removePath,
}: {
  invoiceId: number;
  inputId: string;
  name: "pdf" | "xml";
  fileId: number | null;
  label: "PDF" | "XML";
  accept: string;
  selectedName: "pdfName" | "xmlName";
  file?: FileRecord | null;
  justUploaded?: boolean;
  removePath: string;
}) {
  return (
    <div class="rounded-md border border-base-300/60 bg-base-100/45 p-2">
      <input
        type="file"
        id={inputId}
        name={name}
        accept={accept}
        class="sr-only"
        x-on:change={`${selectedName} = $event.target.files?.[0]?.name || ''`}
      />
      <div class="flex min-w-0 items-center gap-2">
        <div class="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-base-200 text-xs font-bold text-base-content/70">
          {label}
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex min-w-0 items-center gap-2">
            <span class="truncate text-sm font-medium">
              {fileId ? `${label} attached` : `No ${label} linked`}
            </span>
            {justUploaded ? (
              <span class="badge badge-success badge-xs shrink-0">Uploaded</span>
            ) : null}
          </div>
          <div class="mt-0.5 truncate text-xs text-base-content/55">
            <span x-show={`!${selectedName}`}>
              {fileId
                ? `${file?.originalFilename ?? `File #${fileId}`}${file ? ` · ${formatBytes(file.sizeBytes)}` : ""}`
                : "Optional"}
            </span>
            <span
              x-show={selectedName}
              x-text={`'Selected: ' + ${selectedName}`}
              class="text-warning"
              style="display:none"
            ></span>
          </div>
        </div>
        <div class="flex shrink-0 items-center gap-1">
          <label
            for={inputId}
            class="btn btn-ghost btn-xs btn-square"
            title={fileId ? `Replace ${label}` : `Upload ${label}`}
            aria-label={fileId ? `Replace ${label}` : `Upload ${label}`}
          >
            <Icon name="upload" />
          </label>
          {fileId ? (
            <a
              href={`/invoices/${invoiceId}/files/${fileId}`}
              class="btn btn-ghost btn-xs btn-square"
              title={`Download ${label}`}
              aria-label={`Download ${label}`}
            >
              <Icon name="download" />
            </a>
          ) : null}
          {fileId ? (
            <button
              type="button"
              class="btn btn-ghost btn-xs btn-square text-error"
              hx-delete={removePath}
              hx-target="#invoice-nfse-link"
              hx-swap="outerHTML"
              hx-confirm={`Remove linked ${label} file? The stored file record is kept, but it will no longer be linked to this NFS-e.`}
              title={`Remove ${label}`}
              aria-label={`Remove ${label}`}
            >
              <Icon name="trash" />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
