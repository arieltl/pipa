import { join } from "node:path";
import type {
  Client,
  FileRecord,
  Invoice,
  InvoiceItem,
  NotaFiscalLink,
  NumberingProfile,
} from "../../db/schema.ts";
import { paths } from "../../config/paths.ts";
import { buildInvoicePdfViewModel } from "../../pdf/view-model.ts";
import { renderInvoicePdfBuffer } from "../../pdf/render.tsx";
import { supersedeFile } from "../files/files.service.ts";
import type { NotaFiscalLinkFormInput } from "./invoices.schema.ts";
import { minorToDecimalString, parseMoneyToMinor } from "../../domain/money.ts";
import {
  isResetPeriod,
  periodKeyFor,
  renderNumberPattern,
} from "../../domain/numbering.ts";
import { renderTemplate } from "../../domain/template-engine.ts";
import { renderFilename } from "../../domain/filename-template.ts";
import * as repo from "./invoices.repository.ts";
import type { InvoiceListRow } from "./invoices.repository.ts";
import { buildInvoiceContext } from "./invoice-template-context.ts";
import type { CreateInvoiceInput, ItemFormInput } from "./invoices.schema.ts";
import { loadIssuerSettings } from "../settings/settings.service.ts";
import { db } from "../../db/client.ts";
import { numberingProfiles } from "../../db/schema.ts";
import { eq } from "drizzle-orm";

type ItemRow = { name: string; value: number; source: string; notes: string | null };

/** Raised when a chosen/generated invoice number already exists. */
export class InvoiceNumberTakenError extends Error {
  constructor(public number: string) {
    super(`Invoice number "${number}" is already in use`);
    this.name = "InvoiceNumberTakenError";
  }
}

/** Raised when no profile is set and no manual number was provided. */
export class InvoiceNumberRequiredError extends Error {
  constructor() {
    super("A manual invoice number is required when the client has no profile");
    this.name = "InvoiceNumberRequiredError";
  }
}

/** Raised when the selected client does not exist. */
export class ClientNotFoundError extends Error {
  constructor() {
    super("Selected client was not found");
    this.name = "ClientNotFoundError";
  }
}

export type InvoiceDetail = {
  invoice: Invoice;
  client: Client;
  items: InvoiceItem[];
  total: number;
  notaFiscal: NotaFiscalLink | null;
  archivedPdf: FileRecord | null;
};

/** An editable item row in the create form, before the invoice exists. */
export type ItemDraft = {
  name: string;
  value: string;
  source: string;
  notes: string;
};

/** Defaults used to seed the create form for a client (currency + fixed item). */
export type ClientSeed = {
  currency: string;
  fixedMonthly: ItemDraft | null;
};

/**
 * Seed values for the create form given a client: its default currency and, if
 * configured, the fixed monthly item (name rendered from the client's template
 * against the chosen date; the invoice number isn't known yet so `{{invoice.
 * number}}` resolves empty — the user can edit before creating).
 */
export function clientSeed(client: Client, invoiceDate: string): ClientSeed {
  if (client.defaultFixedMonthlyValue == null) {
    return { currency: client.defaultCurrency, fixedMonthly: null };
  }
  const issuer = loadIssuerSettings();
  const template = client.defaultFixedMonthlyItemNameTemplate;
  const name = template
    ? renderTemplate(
        template,
        buildInvoiceContext({
          number: "",
          invoiceDate,
          currency: client.defaultCurrency,
          totalMinor: client.defaultFixedMonthlyValue,
          client,
          issuer,
          items: [],
        }),
      ).output
    : FIXED_MONTHLY_FALLBACK_NAME;
  return {
    currency: client.defaultCurrency,
    fixedMonthly: {
      name,
      value: minorToDecimalString(
        client.defaultFixedMonthlyValue,
        client.defaultCurrency,
      ),
      source: "fixed_monthly",
      notes: "",
    },
  };
}

/** Static context the invoice composer needs for a given client. */
export function composerContext(client: Client): {
  issuer: ReturnType<typeof loadIssuerSettings>;
  currencyDefault: string;
  hasProfile: boolean;
} {
  return {
    issuer: loadIssuerSettings(),
    currencyDefault: client.defaultCurrency,
    hasProfile: client.numberingProfileId != null,
  };
}

export function listInvoices(): InvoiceListRow[] {
  return repo.listInvoices();
}

export function listInvoicesByClient(clientId: number): InvoiceListRow[] {
  return repo.listInvoicesByClient(clientId);
}

export function clientInvoiceStats(): Map<number, repo.ClientInvoiceStats> {
  return new Map(repo.clientInvoiceStats().map((s) => [s.clientId, s]));
}

export function getClient(id: number): Client | null {
  return repo.getClientById(id);
}

/** Full invoice view: invoice + client + items + computed total. */
export function getInvoiceDetail(id: number): InvoiceDetail | null {
  const invoice = repo.getInvoiceById(id);
  if (!invoice) return null;
  const client = repo.getClientById(invoice.clientId);
  if (!client) return null;
  const items = repo.listItems(id);
  const archivedPdf =
    invoice.archivedPdfFileId != null
      ? repo.getFileById(invoice.archivedPdfFileId)
      : null;
  return {
    invoice,
    client,
    items,
    total: sum(items),
    notaFiscal: repo.getNotaFiscalLink(id),
    archivedPdf,
  };
}

export function getInvoiceItems(invoiceId: number): InvoiceItem[] {
  return repo.listItems(invoiceId);
}

export function invoiceTotal(invoiceId: number): number {
  return repo.invoiceTotal(invoiceId);
}

function sum(items: InvoiceItem[]): number {
  return items.reduce((acc, item) => acc + item.value, 0);
}

function getProfile(id: number | null): NumberingProfile | null {
  if (id == null) return null;
  return (
    db.select().from(numberingProfiles).where(eq(numberingProfiles.id, id)).get() ??
    null
  );
}

/**
 * Default name for the copied fixed monthly item when the client has no name
 * template. Template rendering (`{{client.name}} …`) lands in Phase 4; until
 * then a set template is copied verbatim and is editable per invoice.
 */
const FIXED_MONTHLY_FALLBACK_NAME = "Monthly software development services";

/**
 * Create an invoice for a client. Copies the client's default fixed monthly
 * item into the invoice at creation time (snapshot, never a live reference —
 * spec §5) when requested and a default value exists. Numbering uses the
 * client's profile unless a manual number is supplied or no profile is set.
 */
export function createInvoice(input: CreateInvoiceInput): Invoice {
  const client = repo.getClientById(input.clientId);
  if (!client) throw new ClientNotFoundError();

  // Items come from the create form (already edited by the user). They are
  // concrete snapshots and do not depend on the allocated number.
  const items: ItemRow[] = input.items.map((it) => ({
    name: it.name,
    value: parseMoneyToMinor(it.value, input.currency) ?? 0,
    source: it.source,
    notes: it.notes ?? null,
  }));
  const buildItems = () => items;

  const profile = getProfile(client.numberingProfileId);
  const useManual = input.manualNumber !== undefined || profile === null;

  if (useManual) {
    const number = input.manualNumber;
    if (number === undefined) throw new InvoiceNumberRequiredError();
    if (repo.getInvoiceByNumber(number)) {
      throw new InvoiceNumberTakenError(number);
    }
    return repo.createManualInvoice({
      invoice: {
        clientId: client.id,
        number,
        numberingProfileId: profile?.id ?? null,
        invoiceDate: input.invoiceDate,
        currency: input.currency,
        status: "draft",
        nfseDescription: null,
        notes: input.notes ?? null,
      },
      items: buildItems(),
    });
  }

  const resetPeriod = isResetPeriod(profile.resetPeriod)
    ? profile.resetPeriod
    : "monthly";
  const periodKey = periodKeyFor(resetPeriod, input.invoiceDate);

  try {
    return repo.allocateAndCreateInvoice({
      clientId: client.id,
      numberingProfileId: profile.id,
      periodKey,
      numberFor: (seq) =>
        renderNumberPattern(profile.pattern, {
          clientCode: client.code,
          invoiceDate: input.invoiceDate,
          seq,
        }),
      invoice: {
        invoiceDate: input.invoiceDate,
        currency: input.currency,
        status: "draft",
        nfseDescription: null,
        notes: input.notes ?? null,
      },
      buildItems,
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new InvoiceNumberTakenError("(generated)");
    }
    throw err;
  }
}

// --- item CRUD -----------------------------------------------------------

export function getItem(id: number): InvoiceItem | null {
  return repo.getItemById(id);
}

function toItemColumns(input: ItemFormInput): repo.ItemInput {
  // value validity is guaranteed by the schema's superRefine.
  const value = parseMoneyToMinor(input.value, input.currency) ?? 0;
  return {
    name: input.name,
    value,
    source: input.source,
    notes: input.notes ?? null,
  };
}

export function addItem(invoiceId: number, input: ItemFormInput): InvoiceItem {
  return repo.insertItem(invoiceId, toItemColumns(input));
}

export function updateItem(id: number, input: ItemFormInput): InvoiceItem {
  return repo.updateItem(id, toItemColumns(input));
}

export function deleteItem(id: number): void {
  repo.deleteItem(id);
}

export function setStatus(id: number, status: string): Invoice {
  return repo.updateInvoiceStatus(id, status);
}

// --- nota fiscal description + filename ----------------------------------

/** Template context for a fully-loaded invoice (includes the running total). */
function contextFor(detail: InvoiceDetail) {
  return buildInvoiceContext({
    number: detail.invoice.number,
    invoiceDate: detail.invoice.invoiceDate,
    currency: detail.invoice.currency,
    totalMinor: detail.total,
    client: detail.client,
    issuer: loadIssuerSettings(),
    items: detail.items,
  });
}

/**
 * Render the client's nota fiscal template against the invoice (spec §12–13).
 * Returns the generated text without saving; the route lets the user edit and
 * then save it explicitly. Empty when the client has no template.
 */
export function generateNfseDescription(detail: InvoiceDetail): string {
  const template = detail.client.defaultNfseDescriptionTemplate;
  if (!template || template.trim() === "") return "";
  return renderTemplate(template, contextFor(detail)).output;
}

/** Persist the final (edited) nota fiscal text; blank clears it. */
export function saveNfseDescription(id: number, text: string): Invoice {
  const trimmed = text.trim();
  return repo.updateInvoiceNfse(id, trimmed === "" ? null : trimmed);
}

/** Safe PDF basename for an invoice, from the client's filename template. */
export function pdfFilename(detail: InvoiceDetail): string {
  return renderFilename(
    detail.client.defaultPdfFilenameTemplate,
    contextFor(detail),
    `invoice-${detail.invoice.number}`,
  );
}

// --- PDF generation, archive, and nota fiscal linking (Phase 5) ----------

/** PDF view model for the invoice, including any linked nota fiscal metadata. */
function pdfViewModel(detail: InvoiceDetail) {
  return buildInvoicePdfViewModel({
    invoice: detail.invoice,
    client: detail.client,
    items: detail.items,
    total: detail.total,
    issuer: loadIssuerSettings(),
    notaFiscal: detail.notaFiscal,
  });
}

/**
 * Render the invoice to PDF bytes on demand (spec §18 — invoice data is the
 * source of truth; regenerated PDFs are transient and not stored).
 */
export async function renderInvoicePdf(
  detail: InvoiceDetail,
): Promise<{ buffer: Buffer; filename: string }> {
  const buffer = await renderInvoicePdfBuffer(pdfViewModel(detail));
  return { buffer, filename: pdfFilename(detail) };
}

/**
 * Freeze the current PDF as an immutable archive (spec §18, §21). Writes a new
 * hashed file under `archived/invoices/<year>/`; if the invoice was already
 * archived, the prior file is superseded (never overwritten) and the invoice
 * points at the new one.
 */
export async function archiveInvoicePdf(
  detail: InvoiceDetail,
): Promise<FileRecord> {
  const buffer = await renderInvoicePdfBuffer(pdfViewModel(detail));
  const year = detail.invoice.invoiceDate.slice(0, 4) || "unknown";
  const destDir = join(paths.archivedInvoicesDir, year);

  const stored = supersedeFile(detail.invoice.archivedPdfFileId, {
    kind: "archived_invoice",
    bytes: buffer,
    destDir,
    desiredBasename: pdfFilename(detail),
    mimeType: "application/pdf",
  });

  repo.updateInvoiceArchivedPdf(detail.invoice.id, stored.id);
  return stored;
}

export type NotaFiscalUpload = {
  bytes: Uint8Array;
  originalFilename: string | null;
};

/**
 * Link Brazilian nota fiscal / NFS-e metadata to an invoice (spec §16),
 * optionally attaching newly-uploaded PDF/XML files. Existing attachments are
 * superseded rather than overwritten. Returns the updated detail.
 */
export function linkNotaFiscal(
  detail: InvoiceDetail,
  input: NotaFiscalLinkFormInput,
  uploads: { pdf?: NotaFiscalUpload; xml?: NotaFiscalUpload } = {},
): InvoiceDetail {
  const year = detail.invoice.invoiceDate.slice(0, 4) || "unknown";
  const destDir = join(paths.nfseDir, year);
  const existing = detail.notaFiscal;

  let pdfFileId: number | undefined;
  if (uploads.pdf) {
    pdfFileId = supersedeFile(existing?.pdfFileId, {
      kind: "nfse_pdf",
      bytes: uploads.pdf.bytes,
      destDir,
      desiredBasename:
        uploads.pdf.originalFilename ?? `nfse-${detail.invoice.number}.pdf`,
      originalFilename: uploads.pdf.originalFilename,
      mimeType: "application/pdf",
    }).id;
  }

  let xmlFileId: number | undefined;
  if (uploads.xml) {
    xmlFileId = supersedeFile(existing?.xmlFileId, {
      kind: "nfse_xml",
      bytes: uploads.xml.bytes,
      destDir,
      desiredBasename:
        uploads.xml.originalFilename ?? `nfse-${detail.invoice.number}.xml`,
      originalFilename: uploads.xml.originalFilename,
      mimeType: "application/xml",
    }).id;
  }

  repo.upsertNotaFiscalLink(detail.invoice.id, {
    nfNumber: input.nfNumber ?? null,
    issueDate: input.issueDate ?? null,
    verificationCode: input.verificationCode ?? null,
    publicUrl: input.publicUrl ?? null,
    notes: input.notes ?? null,
    pdfFileId,
    xmlFileId,
  });

  const updated = getInvoiceDetail(detail.invoice.id);
  if (!updated) throw new Error(`Invoice ${detail.invoice.id} vanished`);
  return updated;
}

/** Resolve a stored file for download, scoped to the given invoice. */
export function getInvoiceFile(
  detail: InvoiceDetail,
  fileId: number,
): FileRecord | null {
  const allowed = new Set(
    [
      detail.invoice.archivedPdfFileId,
      detail.notaFiscal?.pdfFileId,
      detail.notaFiscal?.xmlFileId,
    ].filter((id): id is number => id != null),
  );
  if (!allowed.has(fileId)) return null;
  return repo.getFileById(fileId);
}

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Error &&
    /UNIQUE constraint failed/i.test(err.message)
  );
}
