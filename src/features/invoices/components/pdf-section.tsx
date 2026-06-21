import type { FileRecord, Invoice } from "../../../db/schema.ts";
import { Icon, type IconName } from "../../../web/components/icons.tsx";

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
 * Compact split-button for the common "get me the PDF" action. The primary
 * action prefers the frozen archive once the invoice is no longer a draft.
 */
export function PdfQuickAction({
  invoice,
  archivedPdf,
}: Pick<PdfSectionProps, "invoice" | "archivedPdf">) {
  const prefersArchive = invoice.status !== "draft" && archivedPdf !== null;
  const primary = prefersArchive
    ? {
        href: `/invoices/${invoice.id}/files/${archivedPdf.id}`,
        label: "Archive",
        busy: "Downloading archive...",
        icon: "download" as IconName,
      }
    : {
        href: `/invoices/${invoice.id}/pdf`,
        label: "Regen PDF",
        busy: "Generating PDF...",
        icon: "refresh" as IconName,
      };

  return (
    <div class="join relative z-50 flex w-full" x-data="{ busy: '' }">
      <a
        href={primary.href}
        class="btn btn-primary btn-sm join-item min-w-0 flex-1 justify-center"
        x-on:click={`busy = '${primary.busy}'`}
      >
        <span x-show="!busy" class="inline-flex items-center justify-center gap-1.5">
          <Icon name={primary.icon} />
          <span>{primary.label}</span>
        </span>
        <span x-show="busy" x-text="busy" style="display:none">
          {primary.busy}
        </span>
      </a>
      <div class="dropdown dropdown-end">
        <button
          type="button"
          class="btn btn-primary btn-sm join-item shrink-0 px-2 justify-center"
          tabindex={0}
          aria-label="PDF download options"
        >
          ▾
        </button>
        <ul
          tabindex={0}
          class="menu dropdown-content z-[100] mt-1 w-80 rounded-box border border-base-300 bg-base-100 p-2 text-sm shadow-2xl"
        >
          <li>
            <a
              href={`/invoices/${invoice.id}/pdf`}
              x-on:click="busy = 'Generating PDF...'"
            >
              <Icon name="refresh" />
              <span>Regen PDF</span>
            </a>
          </li>
          {archivedPdf ? (
            <li>
              <a
                href={`/invoices/${invoice.id}/files/${archivedPdf.id}`}
                x-on:click="busy = 'Downloading archive...'"
              >
                <Icon name="download" />
                <span>Archive</span>
              </a>
            </li>
          ) : null}
          <li>
            <form
              method="post"
              action={`/invoices/${invoice.id}/pdf/archive-download`}
            >
              <button
                type="submit"
                class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left"
                x-on:click="busy = 'Re-archiving PDF...'"
              >
                <Icon name="archive" />
                <span>Regen, archive, download</span>
              </button>
            </form>
          </li>
        </ul>
      </div>
    </div>
  );
}

/**
 * Detailed PDF archive panel. This is intentionally more explicit than the top
 * quick action: it shows archive state, file metadata, and slower management
 * actions.
 */
export function PdfSection({
  invoice,
  archivedPdf,
  filename,
  archived,
}: PdfSectionProps) {
  const actionGrid = archivedPdf
    ? "sm:grid-cols-2 xl:grid-cols-4"
    : "sm:grid-cols-3";

  return (
    <div id="invoice-pdf" class="app-card rounded-lg p-4" x-data="{ busy: '' }">
      {archived ? (
        <div class="mb-3 text-sm text-success">PDF archived.</div>
      ) : null}

      <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div class="min-w-0">
          <div class="text-sm font-medium">Generated filename</div>
          <code class="mt-1 block font-mono text-sm text-base-content/80 break-all">
            {filename}
          </code>
          <p class="mt-2 text-xs leading-relaxed text-base-content/50">
            Issuing archives automatically. Re-archiving stores a new immutable
            file and supersedes the old metadata without overwriting bytes.
          </p>
        </div>

        <ArchiveStatus archivedPdf={archivedPdf} />
      </div>

      {archivedPdf ? (
        <ArchiveDetails invoice={invoice} archivedPdf={archivedPdf} />
      ) : null}

      <div class="mt-4 grid gap-2">
        <span
          x-show="busy"
          x-text="busy"
          class="text-sm text-info"
        ></span>
        <div class={`grid gap-2 ${actionGrid}`}>
          <a
            href={`/invoices/${invoice.id}/pdf`}
            class="btn btn-ghost btn-sm w-full"
            x-on:click="busy = 'Generating live PDF...'"
          >
            <Icon name="refresh" />
            <span>Live PDF</span>
          </a>
          <button
            type="button"
            class={`btn btn-sm w-full ${archivedPdf ? "btn-warning" : "btn-secondary"}`}
            hx-post={`/invoices/${invoice.id}/archive`}
            hx-target="#invoice-pdf"
            hx-swap="outerHTML"
            hx-confirm={
              archivedPdf
                ? "Re-archive? The previous archived PDF is kept and superseded."
                : "Freeze the current PDF as an immutable archive?"
            }
            x-on:click="busy = 'Archiving PDF...'"
          >
            <Icon name="archive" />
            <span>{archivedPdf ? "Re-archive" : "Archive"}</span>
          </button>
          {archivedPdf ? (
            <a
              href={`/invoices/${invoice.id}/files/${archivedPdf.id}`}
              class="btn btn-ghost btn-sm w-full"
              x-on:click="busy = 'Downloading archive...'"
            >
              <Icon name="download" />
              <span>Archived PDF</span>
            </a>
          ) : null}
          <form
            method="post"
            action={`/invoices/${invoice.id}/pdf/archive-download`}
            class="contents"
          >
            <button
              type="submit"
              class="btn btn-primary btn-sm w-full"
              x-on:click="busy = 'Re-archiving PDF...'"
            >
              <Icon name="archive" />
              <span>Re-archive + download</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function ArchiveStatus({ archivedPdf }: { archivedPdf: FileRecord | null }) {
  return (
    <div class="rounded-md border border-base-300/80 bg-base-200/55 p-3 text-sm lg:min-w-60">
      <div class="text-xs font-semibold uppercase tracking-wide text-base-content/45">
        Archive status
      </div>
      <div class="mt-1 font-medium">
        {archivedPdf ? "Archived PDF available" : "Not archived yet"}
      </div>
      <div class="mt-1 text-xs text-base-content/50">
        {archivedPdf
          ? "The primary download uses the frozen copy."
          : "Draft downloads are generated live."}
      </div>
    </div>
  );
}

function ArchiveDetails({
  invoice,
  archivedPdf,
}: {
  invoice: Invoice;
  archivedPdf: FileRecord;
}) {
  return (
    <div class="mt-3 rounded-md border border-base-300/80 bg-base-200/55 p-3 text-sm">
      <div class="flex flex-wrap items-center justify-between gap-3">
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
          x-on:click="busy = 'Downloading archive...'"
        >
          <Icon name="download" />
          <span>Download archived</span>
        </a>
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
