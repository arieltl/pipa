import { join } from "node:path";
import { nowIso } from "../../domain/dates.ts";
import type {
  Client,
  ClientInvoiceRecordType,
  ClientTextGenerator,
  FileRecord,
  Invoice,
  InvoiceItem,
  InvoiceGeneratedText,
  IssuerSettings,
  NotaFiscalLink,
  NumberingProfile,
  PdfTemplate,
  PdfTemplateRevision,
} from "../../db/schema.ts";
import { applicableRecordTypes, listInvoiceRecords, type InvoiceRecordView } from "../invoice-records/invoice-records.instances.ts";
import { paths } from "../../config/paths.ts";
import { buildInvoiceDocumentModel } from "../../pdf/document-model.ts";
import { renderPdf } from "../../pdf/renderer-registry.ts";
import { supersedeFile } from "../files/files.service.ts";
import type { NotaFiscalLinkFormInput } from "./invoices.schema.ts";
import { minorToDecimalString, parseMoneyToMinor } from "../../domain/money.ts";
import {
  hasSequenceToken,
  isResetPeriod,
  periodKeyFor,
  renderNumberPattern,
} from "../../domain/numbering.ts";
import { renderTemplate } from "../../domain/template-engine.ts";
import {
  canManuallyTransition,
  isDocumentEditable,
} from "../../domain/invoice-status.ts";
import { renderFilename } from "../../domain/filename-template.ts";
import * as repo from "./invoices.repository.ts";
import type { InvoiceListRow } from "./invoices.repository.ts";
import { buildInvoiceContext } from "./invoice-template-context.ts";
import type {
  CreateInvoiceInput,
  EditInvoiceDocInput,
  ItemFormInput,
} from "./invoices.schema.ts";
import { loadIssuerSettings } from "../settings/settings.service.ts";
import { GotenbergConnectionError } from "../../pdf/html/gotenberg-client.ts";
import { db } from "../../db/client.ts";
import { invoiceFileOwnership, invoices, numberingProfiles } from "../../db/schema.ts";
import { and, eq, sql } from "drizzle-orm";
import { createPartySnapshot, serializePartySnapshot } from "../../domain/party-fields/snapshot.ts";
import { operationIdentity, sha256Identity, WorkspaceConflictError } from "../../domain/invoice-workspace.ts";
import {
  getRevision,
  getTemplate,
  listSelectableTemplates,
  resolveTemplateRevision,
  PdfTemplateArchivedError,
  PdfTemplateNotFoundError,
  PdfEngineNotConfiguredError,
} from "../pdf-templates/pdf-templates.service.ts";
import {
  generateText,
  getNfseTextGenerator,
  getSavedGeneratedText,
  listClientTextGenerators,
  listSavedGeneratedTexts,
  saveGeneratedText,
  saveGeneratedTextSnapshot,
} from "../text-generators/text-generators.service.ts";

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

export class SequenceOverrideUnavailableError extends Error {
  constructor() {
    super("The selected numbering profile does not use a sequence token");
    this.name = "SequenceOverrideUnavailableError";
  }
}

/** Raised when the selected client does not exist. */
export class ClientNotFoundError extends Error {
  constructor() {
    super("Selected client was not found");
    this.name = "ClientNotFoundError";
  }
}

/** Raised when a status change is not allowed by the lifecycle. */
export class InvalidStatusTransitionError extends Error {
  constructor(public from: string, public to: string) {
    super(`Cannot change status from "${from}" to "${to}"`);
    this.name = "InvalidStatusTransitionError";
  }
}

/** Raised when editing the locked document of a non-draft invoice. */
export class DocumentLockedError extends Error {
  constructor() {
    super("Invoice document is locked; revert to draft to edit");
    this.name = "DocumentLockedError";
  }
}

/** Raised when trying to issue an invoice with no line items. */
export class EmptyInvoiceError extends Error {
  constructor() {
    super("Add at least one item before issuing");
    this.name = "EmptyInvoiceError";
  }
}

export type InvoiceDetail = {
  invoice: Invoice;
  client: Client;
  issuer: IssuerSettings | null;
  items: InvoiceItem[];
  total: number;
  notaFiscal: NotaFiscalLink | null;
  notaFiscalPdf: FileRecord | null;
  notaFiscalXml: FileRecord | null;
  archivedPdf: FileRecord | null;
  textGenerators: ClientTextGenerator[];
  generatedTexts: InvoiceGeneratedText[];
  recordTypes: ClientInvoiceRecordType[];
  records: InvoiceRecordView[];
  pdfTemplate: PdfTemplate;
  pdfTemplateRevision: PdfTemplateRevision;
  pdfTemplateOptions: PdfTemplate[];
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
  pdfTemplates: PdfTemplate[];
  defaultPdfTemplateId: number | null;
  templateError?: string;
} {
  const issuer = loadIssuerSettings();
  let defaultPdfTemplateId: number | null = null;
  let templateError: string | undefined;
  try {
    defaultPdfTemplateId = resolveTemplateRevision(client, issuer).templateId;
  } catch (error) {
    if (
      error instanceof PdfTemplateArchivedError ||
      error instanceof PdfTemplateNotFoundError ||
      error instanceof PdfEngineNotConfiguredError
    ) {
      templateError = error.message;
    } else throw error;
  }
  return {
    issuer,
    currencyDefault: client.defaultCurrency,
    hasProfile: client.numberingProfileId != null,
    pdfTemplates: listSelectableTemplates(),
    defaultPdfTemplateId,
    ...(templateError ? { templateError } : {}),
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
  const notaFiscal = repo.getNotaFiscalLink(id);
  const issuer = loadIssuerSettings();
  const pdfTemplateRevision = invoice.pdfTemplateRevisionId
    ? getRevision(invoice.pdfTemplateRevisionId)
    : resolveTemplateRevision(client, issuer);
  const pdfTemplate = getTemplate(pdfTemplateRevision.templateId);
  return {
    invoice,
    client,
    issuer,
    items,
    total: sum(items),
    notaFiscal,
    notaFiscalPdf:
      notaFiscal?.pdfFileId != null ? repo.getFileById(notaFiscal.pdfFileId) : null,
    notaFiscalXml:
      notaFiscal?.xmlFileId != null ? repo.getFileById(notaFiscal.xmlFileId) : null,
    archivedPdf,
    textGenerators: listClientTextGenerators(client.id),
    generatedTexts: listSavedGeneratedTexts(invoice.id),
    recordTypes: applicableRecordTypes(client.id),
    records: listInvoiceRecords(invoice.id),
    pdfTemplate,
    pdfTemplateRevision,
    pdfTemplateOptions: listSelectableTemplates(),
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
  const currentIssuer = loadIssuerSettings();
  const snapshotColumns = {
    issuerSnapshotJson: serializePartySnapshot(currentIssuer
      ? createPartySnapshot(currentIssuer)
      : { name: "Invoice", fields: [] }),
    clientSnapshotJson: serializePartySnapshot(createPartySnapshot(client)),
    pdfTemplateRevisionId: resolveTemplateRevision(
      client,
      currentIssuer,
      input.pdfTemplateId,
    ).id,
  };

  // Items come from the create form (already edited by the user). They are
  // concrete snapshots and do not depend on the allocated number.
  const items: ItemRow[] = input.items.map((it) => ({
    name: it.name,
    value: parseMoneyToMinor(it.value, input.currency) ?? 0,
    source: it.source,
    notes: it.notes ?? null,
  }));
  const buildItems = () => items;

  const numberingMode = input.numberingMode ?? "auto";
  const profile = getProfile(client.numberingProfileId);
  const useManual = numberingMode === "manual" || profile === null;

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
        ...snapshotColumns,
      },
      items: buildItems(),
    });
  }

  if (numberingMode === "sequence") {
    if (!hasSequenceToken(profile.pattern)) {
      throw new SequenceOverrideUnavailableError();
    }
    if (input.sequenceOverride === undefined) {
      throw new InvoiceNumberRequiredError();
    }
    const resetPeriod = isResetPeriod(profile.resetPeriod)
      ? profile.resetPeriod
      : "monthly";
    const periodKey = periodKeyFor(resetPeriod, input.invoiceDate);
    try {
      return repo.createInvoiceWithSequenceOverride({
        clientId: client.id,
        numberingProfileId: profile.id,
        periodKey,
        sequence: input.sequenceOverride,
        advanceSequence: input.advanceSequence ?? true,
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
          ...snapshotColumns,
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
        ...snapshotColumns,
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
    notes: null,
  };
}

/** Guard: line-item edits are only allowed while the invoice is a draft. */
function assertDocumentEditable(invoiceId: number): void {
  const invoice = repo.getInvoiceById(invoiceId);
  if (!invoice || !isDocumentEditable(invoice.status)) {
    throw new DocumentLockedError();
  }
}

/** Compatibility writers predate aggregate commands.  Keep their mutations
 * visible to workspace clients until their retired HTTP routes disappear. */
function advanceLegacyRevision(invoiceId: number): void {
  db.update(invoices).set({ workspaceRevision: sql`${invoices.workspaceRevision} + 1`, updatedAt: nowIso() }).where(eq(invoices.id, invoiceId)).run();
}
function legacyWrite<T>(invoiceId: number, write: () => T): T {
  return db.transaction(() => { const result = write(); advanceLegacyRevision(invoiceId); return result; });
}

export function addItem(invoiceId: number, input: ItemFormInput): InvoiceItem {
  return legacyWrite(invoiceId, () => { assertDocumentEditable(invoiceId); return repo.insertItem(invoiceId, toItemColumns(input)); });
}

export function updateItem(id: number, input: ItemFormInput): InvoiceItem {
  const item = repo.getItemById(id);
  if (!item) throw new DocumentLockedError();
  return legacyWrite(item.invoiceId, () => { assertDocumentEditable(item.invoiceId); return repo.updateItem(id, toItemColumns(input)); });
}

export function deleteItem(id: number): void {
  const item = repo.getItemById(id);
  if (!item) throw new DocumentLockedError();
  legacyWrite(item.invoiceId, () => { assertDocumentEditable(item.invoiceId); repo.deleteItem(id); });
}

// --- draft document edit + delete ----------------------------------------

/**
 * Edit a draft invoice's identity fields (number + date shown on the PDF).
 * Only allowed while the document is editable (draft). The new number must not
 * collide with another invoice.
 */
export function updateInvoiceDoc(
  id: number,
  input: EditInvoiceDocInput,
): Invoice {
  return legacyWrite(id, () => { const invoice = repo.getInvoiceById(id); if (!invoice || !isDocumentEditable(invoice.status)) throw new DocumentLockedError(); const existing = repo.getInvoiceByNumber(input.number); if (existing && existing.id !== id) throw new InvoiceNumberTakenError(input.number); return repo.updateInvoiceDoc(id, { number: input.number, invoiceDate: input.invoiceDate }); });
}

/**
 * Delete a draft invoice and its dependent rows (items, nota fiscal link
 * cascade). Only drafts can be deleted; locked documents must be reverted
 * first. Stored files are append-only and remain on disk.
 */
export function deleteInvoice(id: number): void {
  const invoice = repo.getInvoiceById(id);
  if (!invoice) return;
  if (!isDocumentEditable(invoice.status)) {
    throw new DocumentLockedError();
  }
  repo.deleteInvoice(id);
}

// --- status lifecycle ----------------------------------------------------

/**
 * Manual status change via the generic control. Only the loose cluster
 * (issued/sent/paid/void) interchanges here; crossing the draft↔issued barrier
 * must go through `issueInvoice` / `revertToDraft`.
 */
export function changeStatus(id: number, status: string): Invoice {
  return legacyWrite(id, () => { const invoice = repo.getInvoiceById(id); if (!invoice) throw new InvalidStatusTransitionError("(missing)", status); if (!canManuallyTransition(invoice.status, status)) throw new InvalidStatusTransitionError(invoice.status, status); return repo.updateInvoiceStatus(id, status); });
}

/**
 * Issue a draft invoice: freeze its PDF as the official archive and advance to
 * `issued`, which locks document editing. Requires at least one line item.
 */
export async function issueInvoice(detail: InvoiceDetail): Promise<Invoice> {
  if (detail.invoice.status !== "draft") {
    throw new InvalidStatusTransitionError(detail.invoice.status, "issued");
  }
  if (detail.items.length === 0) throw new EmptyInvoiceError();
  // The legacy public API must use the same render/finalize fence as the
  // workspace command.  Rendering may await for long enough that the detail
  // passed here is obsolete; a direct archive followed by status write could
  // otherwise issue bytes for an earlier invoice revision.
  const arguments_ = { dependencySignature: pdfRenderingDependencySignature(detail) };
  const input = { schemaVersion: 1 as const, operationId: crypto.randomUUID(), expectedRevision: detail.invoice.workspaceRevision, kind: "issue" as const, arguments: arguments_ };
  const canonicalPayloadDigest = operationIdentity({ schemaVersion: input.schemaVersion, kind: input.kind, baseRevision: input.expectedRevision, arguments: input.arguments });
  const { executeWorkspaceCommand } = await import("./invoice-workspace.service.ts");
  const result = await executeWorkspaceCommand(detail.invoice.id, { ...input, canonicalPayloadDigest });
  if (result.outcome === "committed") {
    const updated = repo.getInvoiceById(detail.invoice.id);
    if (updated) return updated;
  }
  if (result.code === "INVALID_STATUS") throw new InvalidStatusTransitionError(detail.invoice.status, "issued");
  if (result.code === "RENDER_FAILED" && !detail.pdfTemplateRevision.rendererKey) throw new GotenbergConnectionError(result.message);
  if (result.code === "STALE_REVISION" || result.code === "DEPENDENCY_CONFLICT") throw new WorkspaceConflictError(result.code, result.message, result.resultingRevision, detail.invoice.status);
  if (result.code === "RENDER_FAILED" && !detail.pdfTemplateRevision.rendererKey) throw new GotenbergConnectionError(result.message);
  throw new Error(result.message);
}

/**
 * Reopen a non-draft invoice for editing. The archived PDF is kept; re-issuing
 * supersedes it (append-only). Allowed from any locked state.
 */
export function revertToDraft(id: number): Invoice {
  const invoice = repo.getInvoiceById(id);
  if (!invoice) throw new InvalidStatusTransitionError("(missing)", "draft");
  if (invoice.status === "draft") {
    throw new InvalidStatusTransitionError("draft", "draft");
  }
  const updated=repo.updateInvoiceStatus(id, "draft"); advanceLegacyRevision(id); return updated;
}

export function refreshPartyDetails(id: number): Invoice {
  const invoice = repo.getInvoiceById(id);
  if (!invoice || !isDocumentEditable(invoice.status)) throw new DocumentLockedError();
  const client = repo.getClientById(invoice.clientId);
  if (!client) throw new ClientNotFoundError();
  const issuer = loadIssuerSettings();
  const updated=repo.updateInvoicePartySnapshots(
    id,
    serializePartySnapshot(issuer ? createPartySnapshot(issuer) : { name: "Invoice", fields: [] }),
    serializePartySnapshot(createPartySnapshot(client)),
  ); advanceLegacyRevision(id); return updated;
}

export function selectDraftPdfTemplate(
  detail: InvoiceDetail,
  templateId: number,
): InvoiceDetail {
  const live = repo.getInvoiceById(detail.invoice.id);
  if (!live || !isDocumentEditable(live.status)) throw new DocumentLockedError();
  const revision = resolveTemplateRevision(detail.client, detail.issuer, templateId);
  legacyWrite(detail.invoice.id, () => { const current=repo.getInvoiceById(detail.invoice.id); if(!current||!isDocumentEditable(current.status))throw new DocumentLockedError(); repo.updateInvoicePdfTemplateRevision(detail.invoice.id, revision.id); });
  const updated = getInvoiceDetail(detail.invoice.id);
  if (!updated) throw new Error(`Invoice ${detail.invoice.id} vanished`);
  return updated;
}

/** Mark a freshly-linked invoice as sent (used by the NFS-e link's checkbox). */
export function markSent(id: number): Invoice {
  return changeStatus(id, "sent");
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
    issuer: detail.issuer,
    items: detail.items,
  });
}

/**
 * Render the client's nota fiscal template against the invoice (spec §12–13).
 * Returns the generated text without saving; the route lets the user edit and
 * then save it explicitly. Empty when the client has no template.
 */
export function generateNfseDescription(detail: InvoiceDetail): string {
  const generator = getNfseTextGenerator(detail.client.id);
  if (generator) return generateText(generator, detail);
  const template = detail.client.defaultNfseDescriptionTemplate;
  if (!template || template.trim() === "") return "";
  return renderTemplate(template, contextFor(detail)).output;
}

/** Persist the final (edited) nota fiscal text; blank clears it. */
export function saveNfseDescription(
  id: number,
  text: string,
  sourceSnapshot?: string,
): InvoiceGeneratedText {
  const trimmed = text.trim();
  const detail = getInvoiceDetail(id);
  if (!detail) throw new Error(`Invoice ${id} was not found`);
  const generator = getNfseTextGenerator(detail.client.id);
  if (generator) {
    const existing = getSavedGeneratedText(id, generator.key);
    const permittedSource =
      sourceSnapshot === generator.source ||
      sourceSnapshot === existing?.sourceSnapshot
        ? sourceSnapshot
        : existing?.sourceSnapshot ?? generator.source;
    return saveGeneratedText(id, generator, trimmed, permittedSource);
  }
  const existing = getSavedGeneratedText(id, "nfse_description");
  return saveGeneratedTextSnapshot(
    id,
    "nfse_description",
    "NFS-e description",
    trimmed,
    sourceSnapshot ?? existing?.sourceSnapshot ?? "",
  );
}

export function generateCustomText(
  detail: InvoiceDetail,
  key: string,
): { generator: ClientTextGenerator; content: string } {
  const generator = detail.textGenerators.find(
    (candidate) => candidate.key === key && candidate.purpose === "custom",
  );
  if (!generator) throw new Error("Text generator was not found");
  return { generator, content: generateText(generator, detail) };
}

export function saveCustomText(
  detail: InvoiceDetail,
  key: string,
  content: string,
  sourceSnapshot?: string,
): InvoiceGeneratedText {
  const generator = detail.textGenerators.find(
    (candidate) => candidate.key === key && candidate.purpose === "custom",
  );
  if (!generator) throw new Error("Text generator was not found");
  const existing = savedTextFor(detail, key);
  const permittedSource =
    sourceSnapshot === generator.source || sourceSnapshot === existing?.sourceSnapshot
      ? sourceSnapshot
      : existing?.sourceSnapshot ?? generator.source;
  return saveGeneratedText(
    detail.invoice.id,
    generator,
    content,
    permittedSource,
  );
}

export function savedTextFor(
  detail: InvoiceDetail,
  key: string,
): InvoiceGeneratedText | null {
  return (
    detail.generatedTexts.find((text) => text.generatorKey === key) ??
    getSavedGeneratedText(detail.invoice.id, key)
  );
}

/** Persist invoice notes; editable in any status. Blank clears them. */
export function saveNotes(id: number, notes: string | undefined): Invoice {
  const trimmed = (notes ?? "").trim();
  return legacyWrite(id, () => repo.updateInvoiceNotes(id, trimmed === "" ? null : trimmed));
}

/** Safe PDF basename for an invoice, from the client's filename template. */
export function pdfFilename(detail: InvoiceDetail): string {
  return renderFilename(
    detail.client.defaultPdfFilenameTemplate,
    contextFor(detail),
    `invoice-${detail.invoice.number}`,
  );
}

/** Every saved-data input that can affect rendered bytes or the output name. */
export function pdfRenderingDependencySignature(detail: InvoiceDetail): string {
  const revision = selectedPdfRevision(detail);
  return sha256Identity({
    document: pdfDocumentModel(detail),
    template: { id: revision.id, templateId: revision.templateId, contentSha256: revision.contentSha256, rendererKey: revision.rendererKey, configurationJson: revision.configurationJson },
    filename: pdfFilename(detail),
    filenameTemplate: detail.client.defaultPdfFilenameTemplate,
    legacyFallbacks: {
      issuerLive: detail.invoice.issuerSnapshotJson == null ? detail.issuer : null,
      clientLive: detail.invoice.clientSnapshotJson == null ? detail.client : null,
    },
  });
}

// --- PDF generation, archive, and nota fiscal linking (Phase 5) ----------

/** PDF view model for the invoice, including any linked nota fiscal metadata. */
function pdfDocumentModel(detail: InvoiceDetail) {
  return buildInvoiceDocumentModel({
    invoice: detail.invoice,
    client: detail.client,
    items: detail.items,
    total: detail.total,
    issuer: detail.issuer,
    notaFiscal: detail.notaFiscal,
    records: detail.records,
  });
}

function selectedPdfRevision(detail: InvoiceDetail) {
  return detail.invoice.pdfTemplateRevisionId
    ? getRevision(detail.invoice.pdfTemplateRevisionId)
    : resolveTemplateRevision(detail.client, detail.issuer);
}

function pdfRenderRequest(detail: InvoiceDetail) {
  return {
    template: selectedPdfRevision(detail),
    document: pdfDocumentModel(detail),
    traceId: crypto.randomUUID(),
  };
}

async function renderSelectedPdf(detail: InvoiceDetail): Promise<Buffer> {
  const request = pdfRenderRequest(detail);
  const startedAt = performance.now();
  const engine = request.template.rendererKey ? "react-pdf" : "gotenberg-html";
  try {
    const buffer = await renderPdf(request);
    console.info(JSON.stringify({
      event: "pdf_render",
      status: "success",
      invoiceId: detail.invoice.id,
      templateId: request.template.templateId,
      revisionId: request.template.id,
      engine,
      traceId: request.traceId,
      durationMs: Math.round(performance.now() - startedAt),
    }));
    return buffer;
  } catch (error) {
    console.error(JSON.stringify({
      event: "pdf_render",
      status: "error",
      invoiceId: detail.invoice.id,
      templateId: request.template.templateId,
      revisionId: request.template.id,
      engine,
      traceId: request.traceId,
      durationMs: Math.round(performance.now() - startedAt),
      category: error instanceof Error ? error.name : "UnknownError",
    }));
    throw error;
  }
}

/**
 * Render the invoice to PDF bytes on demand (spec §18 — invoice data is the
 * source of truth; regenerated PDFs are transient and not stored).
 */
export async function renderInvoicePdf(
  detail: InvoiceDetail,
): Promise<{ buffer: Buffer; filename: string }> {
  // Capture the filename and its live legacy fallbacks before rendering. A
  // command revalidates the same complete dependency signature afterward.
  const filename = pdfFilename(detail);
  const buffer = await renderSelectedPdf(detail);
  return { buffer, filename };
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
  const arguments_ = { dependencySignature: pdfRenderingDependencySignature(detail) };
  const input = { schemaVersion: 1 as const, operationId: crypto.randomUUID(), expectedRevision: detail.invoice.workspaceRevision, kind: "pdf-version" as const, arguments: arguments_ };
  const canonicalPayloadDigest = operationIdentity({ schemaVersion: input.schemaVersion, kind: input.kind, baseRevision: input.expectedRevision, arguments: input.arguments });
  const { executeWorkspaceCommand } = await import("./invoice-workspace.service.ts");
  const result = await executeWorkspaceCommand(detail.invoice.id, { ...input, canonicalPayloadDigest });
  const fileId = (result.normalized as { fileId?: number } | undefined)?.fileId;
  if (result.outcome === "committed" && fileId) {
    const stored = repo.getFileById(fileId);
    if (stored) return stored;
  }
  if (result.code === "STALE_REVISION" || result.code === "DEPENDENCY_CONFLICT") throw new WorkspaceConflictError(result.code, result.message, result.resultingRevision, detail.invoice.status);
  throw new Error(result.message);
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
  // `markSent` is a route-only flag (status side effect), not link data.
  input: Omit<NotaFiscalLinkFormInput, "markSent">,
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
  advanceLegacyRevision(detail.invoice.id);

  const updated = getInvoiceDetail(detail.invoice.id);
  if (!updated) throw new Error(`Invoice ${detail.invoice.id} vanished`);
  return updated;
}

export function removeNotaFiscalAttachment(
  detail: InvoiceDetail,
  attachment: "pdf" | "xml",
): InvoiceDetail {
  repo.clearNotaFiscalAttachment(detail.invoice.id, attachment); advanceLegacyRevision(detail.invoice.id);
  const updated = getInvoiceDetail(detail.invoice.id);
  if (!updated) throw new Error(`Invoice ${detail.invoice.id} vanished`);
  return updated;
}

/** Resolve a stored file for download, scoped to the given invoice. */
export function getInvoiceFile(
  detail: InvoiceDetail,
  fileId: number,
): FileRecord | null {
  // Current pointers cover old datasets. Durable ownership is authoritative
  // for superseded archives, tombstones, and immutable PDF versions.
  const owned = db.select().from(invoiceFileOwnership).where(and(eq(invoiceFileOwnership.invoiceId, detail.invoice.id), eq(invoiceFileOwnership.fileId, fileId))).get();
  const allowed = [detail.invoice.archivedPdfFileId, detail.notaFiscal?.pdfFileId, detail.notaFiscal?.xmlFileId].includes(fileId);
  if (!owned && !allowed) return null;
  return repo.getFileById(fileId);
}

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Error &&
    /UNIQUE constraint failed/i.test(err.message)
  );
}

/** Read-only output for the workspace: saved edits always win over templates. */
export function workspaceGeneratedTexts(detail: InvoiceDetail) {
  const texts: Array<{ generatorKey: string; generatorName: string; content: string; saved: boolean; error?: string }> = detail.generatedTexts.map(text => ({ ...text, saved: true }));
  if (!texts.some(text => text.generatorKey === "nfse_description") && detail.invoice.nfseDescription !== null) {
    texts.push({ generatorKey: "nfse_description", generatorName: "NFS-e description", content: detail.invoice.nfseDescription, saved: true });
  }
  for (const generator of detail.textGenerators) {
    if (texts.some(text => text.generatorKey === generator.key)) continue;
    try {
      texts.push({ generatorKey: generator.key, generatorName: generator.name, content: generateText(generator, detail), saved: false });
    } catch (error) {
      texts.push({ generatorKey: generator.key, generatorName: generator.name, content: "", saved: false, error: error instanceof Error ? error.message : "Text generation failed." });
    }
  }
  return texts;
}
