import type { FileRecord, Invoice } from "../../../db/schema.ts";

export type PdfSectionProps = {
  invoice: Invoice;
  /** The archived PDF file, if this invoice has been frozen. */
  archivedPdf: FileRecord | null;
  /** Generated (live) download filename, for display only. */
  filename: string;
  /** Show the "archived" confirmation banner after a fresh archive. */
  archived?: boolean;
};

/**
 * Invoice PDF actions (spec §18): download a freshly regenerated PDF any time,
 * or freeze the exact current PDF as an immutable archive. Re-archiving
 * supersedes the prior file rather than overwriting it.
 */
export function PdfSection({
  invoice,
  archivedPdf,
  filename,
  archived,
}: PdfSectionProps) {
  return (
    <div id="invoice-pdf" class="app-card rounded-lg p-5">
      {archived ? (
        <div class="mb-3 text-sm text-success">PDF archived.</div>
      ) : null}

      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="min-w-0 text-sm">
          <code class="font-mono text-base-content/80 break-all">{filename}</code>
          <p class="mt-1 text-xs text-base-content/50">
            Download is in the action bar above. Archive freezes the exact PDF
            sent.
          </p>
        </div>
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          hx-post={`/invoices/${invoice.id}/archive`}
          hx-target="#invoice-pdf"
          hx-swap="outerHTML"
          hx-confirm={
            archivedPdf
              ? "Re-archive? The previous archived PDF is kept and superseded."
              : "Freeze the current PDF as an immutable archive?"
          }
        >
          {archivedPdf ? "Re-archive" : "Archive PDF"}
        </button>
      </div>

      {archivedPdf ? (
        <div class="mt-4 rounded-md border border-base-300/80 bg-base-200/55 p-3 text-sm">
          <div class="flex items-center justify-between gap-3">
            <div>
              <div class="font-medium">Archived PDF</div>
              <div class="text-xs text-base-content/50">
                {formatBytes(archivedPdf.sizeBytes)} · sha256{" "}
                <code class="font-mono">{archivedPdf.sha256.slice(0, 12)}…</code>
              </div>
            </div>
            <a
              href={`/invoices/${invoice.id}/files/${archivedPdf.id}`}
              class="btn btn-ghost btn-xs"
            >
              Download archived
            </a>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
