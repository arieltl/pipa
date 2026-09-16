import type {
  Client,
  IssuerSettings,
  PdfTemplate,
  PdfTemplateRevision,
} from "../../db/schema.ts";
import * as repo from "./pdf-templates.repository.ts";
import { nowIso } from "../../domain/dates.ts";
import {
  renderLiquidHtmlPackage,
  validateLiquidHtmlPackage,
} from "../../pdf/html/liquid-engine.ts";
import { isGotenbergConfigured } from "../../config/gotenberg.ts";
import { renderPdf } from "../../pdf/renderer-registry.ts";
import type { PdfRenderRequest } from "../../pdf/renderer.ts";
import { sampleInvoiceDocument } from "../../pdf/sample-document.ts";
import {
  findPackageFile,
  packageFromSource,
  reactPackageFromSource,
  templatePackageEngine,
  validateTemplatePackage,
  templatePackageConfiguration,
  templatePackageFromRevision,
  templatePackageHash,
  type TemplatePackage,
} from "../../domain/template-package.ts";
import { classicEditableReactSource } from "../../pdf/classic-react-template-source.ts";
import { renderReactTemplatePackage } from "../../pdf/react-template-renderer.tsx";
import type { InvoiceDocumentModel } from "../../pdf/document-model.ts";

export class PdfTemplateNotFoundError extends Error {}
export class PdfTemplateArchivedError extends Error {}
export class PdfEngineNotConfiguredError extends Error {}
export class PdfTemplateImmutableError extends Error {}

export function listTemplates(engine?: "react-pdf" | "gotenberg-html") {
  return repo.listTemplates(engine);
}
export function listSelectableTemplates() {
  return repo
    .listTemplates()
    .filter(
      (template) => template.engine === "react-pdf" || isGotenbergConfigured(),
    );
}
export function getRevision(id: number): PdfTemplateRevision {
  const revision = repo.getRevision(id);
  if (!revision)
    throw new PdfTemplateNotFoundError("PDF template revision was not found");
  return revision;
}
export function getTemplate(id: number): PdfTemplate {
  const template = repo.getTemplate(id);
  if (!template)
    throw new PdfTemplateNotFoundError("PDF template was not found");
  return template;
}

export function resolveTemplateRevision(
  client: Client,
  issuer: IssuerSettings | null,
  explicitTemplateId?: number,
): PdfTemplateRevision {
  const templateId =
    explicitTemplateId ??
    client.defaultPdfTemplateId ??
    issuer?.defaultPdfTemplateId ??
    repo.getBuiltinClassic()?.id;
  if (!templateId)
    throw new PdfTemplateNotFoundError("No default PDF template is installed");
  const template = repo.getTemplate(templateId);
  if (!template)
    throw new PdfTemplateNotFoundError("PDF template was not found");
  if (template.archivedAt)
    throw new PdfTemplateArchivedError("The selected PDF template is archived");
  if (template.engine === "gotenberg-html" && !isGotenbergConfigured())
    throw new PdfEngineNotConfiguredError(
      "Gotenberg is not configured for the selected HTML template",
    );
  const revision = repo.getActiveCurrentRevision(template.id);
  if (!revision)
    throw new PdfTemplateNotFoundError("PDF template has no current revision");
  return revision;
}

export function validateDefaultTemplate(id: number | undefined): void {
  if (id === undefined) return;
  const template = repo.getTemplate(id);
  if (!template)
    throw new PdfTemplateNotFoundError("PDF template was not found");
  if (template.archivedAt)
    throw new PdfTemplateArchivedError("The selected PDF template is archived");
  if (template.engine === "gotenberg-html" && !isGotenbergConfigured()) {
    throw new PdfEngineNotConfiguredError(
      "Gotenberg is not configured for the selected HTML template",
    );
  }
  if (!repo.getActiveCurrentRevision(id)) {
    throw new PdfTemplateNotFoundError("PDF template has no current revision");
  }
}

export function listTemplateRevisions(templateId: number) {
  return repo.listRevisions(templateId);
}

function validateHtml(templatePackage: TemplatePackage, document: InvoiceDocumentModel = sampleInvoiceDocument): TemplatePackage {
  const normalized = validateLiquidHtmlPackage(templatePackage);
  renderLiquidHtmlPackage(normalized, document);
  return normalized;
}

function packageForInput(
  source: string,
  templatePackage?: TemplatePackage,
  document: InvoiceDocumentModel = sampleInvoiceDocument,
): TemplatePackage {
  return validateHtml(templatePackage ?? packageFromSource(source), document);
}

function packageForEngine(
  engine: "react-pdf" | "gotenberg-html",
  source: string,
  templatePackage?: TemplatePackage,
  document: InvoiceDocumentModel = sampleInvoiceDocument,
): TemplatePackage {
  const normalized = validateTemplatePackage(
    templatePackage ??
      (engine === "react-pdf"
        ? reactPackageFromSource(source)
        : packageFromSource(source)),
  );
  if (templatePackageEngine(normalized) !== engine)
    throw new PdfTemplateImmutableError(
      "The package entry selects a different PDF engine",
    );
  return engine === "gotenberg-html" ? validateHtml(normalized, document) : normalized;
}

export function getRevisionPackage(
  revision: PdfTemplateRevision,
): TemplatePackage {
  if (revision.rendererKey === "classic" && !revision.source)
    return reactPackageFromSource(classicEditableReactSource);
  return templatePackageFromRevision(
    revision.source,
    revision.configurationJson,
  );
}

export async function createTemplate(
  name: string,
  engine: "react-pdf" | "gotenberg-html",
  source: string,
  templatePackage?: TemplatePackage,
): Promise<PdfTemplate> {
  const normalized = packageForEngine(engine, source, templatePackage);
  if (engine === "react-pdf")
    await renderReactTemplatePackage(normalized, sampleInvoiceDocument);
  const entry = findPackageFile(normalized, normalized.entry)!;
  return repo.insertTemplate({
    name,
    engine,
    source: entry.content,
    configurationJson: templatePackageConfiguration(normalized),
    contentSha256: templatePackageHash(normalized),
    createdAt: nowIso(),
  });
}

export function createHtmlTemplate(
  name: string,
  source: string,
  templatePackage?: TemplatePackage,
): PdfTemplate {
  const normalized = packageForInput(source, templatePackage);
  const entry = findPackageFile(normalized, normalized.entry)!;
  return repo.insertHtmlTemplate({
    name,
    source: entry.content,
    configurationJson: templatePackageConfiguration(normalized),
    contentSha256: templatePackageHash(normalized),
    createdAt: nowIso(),
  });
}

export async function reviseTemplate(
  templateId: number,
  name: string,
  engine: "react-pdf" | "gotenberg-html",
  source: string,
  templatePackage?: TemplatePackage,
): Promise<PdfTemplateRevision> {
  const template = getTemplate(templateId);
  if (template.engine !== engine)
    throw new PdfTemplateImmutableError(
      "The selected PDF engine cannot be changed",
    );
  if (template.sourceKind === "builtin")
    throw new PdfTemplateImmutableError(
      "Duplicate a built-in template before editing it",
    );
  if (template.archivedAt)
    throw new PdfTemplateArchivedError("The template is archived");
  const normalized = packageForEngine(engine, source, templatePackage);
  if (engine === "react-pdf")
    await renderReactTemplatePackage(normalized, sampleInvoiceDocument);
  const entry = findPackageFile(normalized, normalized.entry)!;
  return repo.insertRevision({
    templateId,
    name,
    source: entry.content,
    configurationJson: templatePackageConfiguration(normalized),
    contentSha256: templatePackageHash(normalized),
    createdAt: nowIso(),
  });
}

export function reviseHtmlTemplate(
  templateId: number,
  name: string,
  source: string,
  templatePackage?: TemplatePackage,
): PdfTemplateRevision {
  const template = getTemplate(templateId);
  if (template.engine !== "gotenberg-html")
    throw new PdfTemplateImmutableError("This operation requires an HTML/Liquid template");
  if (template.sourceKind === "builtin")
    throw new PdfTemplateImmutableError(
      "Duplicate a built-in template before editing it",
    );
  if (template.archivedAt)
    throw new PdfTemplateArchivedError("The template is archived");
  const normalized = packageForInput(source, templatePackage);
  const entry = findPackageFile(normalized, normalized.entry)!;
  return repo.insertRevision({
    templateId,
    name,
    source: entry.content,
    configurationJson: templatePackageConfiguration(normalized),
    contentSha256: templatePackageHash(normalized),
    createdAt: nowIso(),
  });
}

export async function duplicateTemplate(
  templateId: number,
  name?: string,
): Promise<PdfTemplate> {
  const template = getTemplate(templateId);
  const revision = getRevision(template.currentRevisionId ?? 0);
  const templatePackage = getRevisionPackage(revision);
  return createTemplate(
    name?.trim() || `${template.name} copy`,
    template.engine as "react-pdf" | "gotenberg-html",
    findPackageFile(templatePackage, templatePackage.entry)!.content,
    templatePackage,
  );
}

export function duplicateHtmlTemplate(
  templateId: number,
  name?: string,
): PdfTemplate {
  const template = getTemplate(templateId);
  if (template.engine !== "gotenberg-html")
    throw new PdfTemplateImmutableError(
      "This operation requires an HTML/Liquid template",
    );
  const revision = getRevision(template.currentRevisionId ?? 0);
  const templatePackage = getRevisionPackage(revision);
  return createHtmlTemplate(
    name?.trim() || `${template.name} copy`,
    findPackageFile(templatePackage, templatePackage.entry)!.content,
    templatePackage,
  );
}

export function renderHtmlSample(
  source: string,
  templatePackage?: TemplatePackage,
): string {
  const rendered = renderLiquidHtmlPackage(
    packageForInput(source, templatePackage),
    sampleInvoiceDocument,
  );
  return findPackageFile(rendered, rendered.entry)!.content;
}

/**
 * Renders unsaved editor source with fictional data. The revision-shaped value
 * exists only for the renderer call and is deliberately never persisted.
 */
export async function renderHtmlPreviewPdf(
  source: string,
  renderer: (request: PdfRenderRequest) => Promise<Buffer> = renderPdf,
  templatePackage?: TemplatePackage,
  document: InvoiceDocumentModel = sampleInvoiceDocument,
): Promise<Buffer> {
  // Validate before testing the renderer or making a network request, so the
  // editor can always surface actionable Liquid errors.
  const normalized = packageForInput(source, templatePackage, document);
  const entry = findPackageFile(normalized, normalized.entry)!;
  if (!isGotenbergConfigured()) {
    throw new PdfEngineNotConfiguredError(
      "Gotenberg is not configured for HTML PDF previews",
    );
  }
  return renderer({
    template: {
      id: 0,
      templateId: 0,
      revision: 0,
      rendererKey: null,
      source: entry.content,
      configurationJson: templatePackageConfiguration(normalized),
      contentSha256: templatePackageHash(normalized),
      createdAt: nowIso(),
    },
    document,
    traceId: crypto.randomUUID(),
  });
}

export async function renderTemplatePreviewPdf(
  engine: "react-pdf" | "gotenberg-html",
  source: string,
  templatePackage?: TemplatePackage,
  document: InvoiceDocumentModel = sampleInvoiceDocument,
): Promise<Buffer> {
  const normalized = packageForEngine(engine, source, templatePackage, document);
  const entry = findPackageFile(normalized, normalized.entry)!;
  if (engine === "gotenberg-html")
    return renderHtmlPreviewPdf(entry.content, undefined, normalized, document);
  return renderPdf({
    template: {
      id: 0,
      templateId: 0,
      revision: 0,
      rendererKey: null,
      source: entry.content,
      configurationJson: templatePackageConfiguration(normalized),
      contentSha256: templatePackageHash(normalized),
      createdAt: nowIso(),
    },
    document,
    traceId: crypto.randomUUID(),
  });
}

export async function renderTemplateSamplePdf(
  templateId: number,
): Promise<Buffer> {
  const template = getTemplate(templateId);
  if (template.archivedAt) {
    throw new PdfTemplateArchivedError("The template is archived");
  }
  if (template.engine === "gotenberg-html" && !isGotenbergConfigured()) {
    throw new PdfEngineNotConfiguredError(
      "Gotenberg is not configured for HTML PDF previews",
    );
  }
  const revision = getRevision(template.currentRevisionId ?? 0);
  return renderPdf({
    template: revision,
    document: sampleInvoiceDocument,
    traceId: crypto.randomUUID(),
  });
}
