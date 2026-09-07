import type { Client, IssuerSettings, PdfTemplate, PdfTemplateRevision } from "../../db/schema.ts";
import * as repo from "./pdf-templates.repository.ts";
import { createHash } from "node:crypto";
import { nowIso } from "../../domain/dates.ts";
import {
  renderLiquidHtml,
  validateLiquidHtmlSource,
} from "../../pdf/html/liquid-engine.ts";
import { isGotenbergConfigured } from "../../config/gotenberg.ts";
import { renderPdf } from "../../pdf/renderer-registry.ts";
import { sampleInvoiceDocument } from "../../pdf/sample-document.ts";

export class PdfTemplateNotFoundError extends Error {}
export class PdfTemplateArchivedError extends Error {}
export class PdfEngineNotConfiguredError extends Error {}
export class PdfTemplateImmutableError extends Error {}

export function listTemplates(engine?: "react-pdf" | "gotenberg-html") { return repo.listTemplates(engine); }
export function listSelectableTemplates() {
  return repo
    .listTemplates()
    .filter(
      (template) =>
        template.engine === "react-pdf" || isGotenbergConfigured(),
    );
}
export function getRevision(id: number): PdfTemplateRevision { const revision = repo.getRevision(id); if (!revision) throw new PdfTemplateNotFoundError("PDF template revision was not found"); return revision; }
export function getTemplate(id: number): PdfTemplate { const template = repo.getTemplate(id); if (!template) throw new PdfTemplateNotFoundError("PDF template was not found"); return template; }

export function resolveTemplateRevision(client: Client, issuer: IssuerSettings | null, explicitTemplateId?: number): PdfTemplateRevision {
  const templateId = explicitTemplateId ?? client.defaultPdfTemplateId ?? issuer?.defaultPdfTemplateId ?? repo.getBuiltinClassic()?.id;
  if (!templateId) throw new PdfTemplateNotFoundError("No default PDF template is installed");
  const template = repo.getTemplate(templateId);
  if (!template) throw new PdfTemplateNotFoundError("PDF template was not found");
  if (template.archivedAt) throw new PdfTemplateArchivedError("The selected PDF template is archived");
  if (template.engine === "gotenberg-html" && !isGotenbergConfigured()) throw new PdfEngineNotConfiguredError("Gotenberg is not configured for the selected HTML template");
  const revision = repo.getActiveCurrentRevision(template.id);
  if (!revision) throw new PdfTemplateNotFoundError("PDF template has no current revision");
  return revision;
}

export function validateDefaultTemplate(id: number | undefined): void {
  if (id === undefined) return;
  const template = repo.getTemplate(id);
  if (!template) throw new PdfTemplateNotFoundError("PDF template was not found");
  if (template.archivedAt) throw new PdfTemplateArchivedError("The selected PDF template is archived");
  if (template.engine === "gotenberg-html" && !isGotenbergConfigured()) {
    throw new PdfEngineNotConfiguredError("Gotenberg is not configured for the selected HTML template");
  }
  if (!repo.getActiveCurrentRevision(id)) {
    throw new PdfTemplateNotFoundError("PDF template has no current revision");
  }
}

export function listTemplateRevisions(templateId: number) {
  return repo.listRevisions(templateId);
}

function validateHtml(source: string): void {
  validateLiquidHtmlSource(source);
  renderLiquidHtml(source, sampleInvoiceDocument);
}

function sha256(source: string): string {
  return createHash("sha256").update(source).digest("hex");
}

export function createHtmlTemplate(name: string, source: string): PdfTemplate {
  validateHtml(source);
  return repo.insertHtmlTemplate({
    name,
    source,
    contentSha256: sha256(source),
    createdAt: nowIso(),
  });
}

export function reviseHtmlTemplate(
  templateId: number,
  name: string,
  source: string,
): PdfTemplateRevision {
  const template = getTemplate(templateId);
  if (template.engine !== "gotenberg-html") {
    throw new PdfTemplateImmutableError("React PDF templates are code-defined");
  }
  if (template.sourceKind === "builtin") {
    throw new PdfTemplateImmutableError("Duplicate a built-in template before editing it");
  }
  if (template.archivedAt) throw new PdfTemplateArchivedError("The template is archived");
  validateHtml(source);
  return repo.insertRevision({
    templateId,
    name,
    source,
    contentSha256: sha256(source),
    createdAt: nowIso(),
  });
}

export function duplicateHtmlTemplate(
  templateId: number,
  name?: string,
): PdfTemplate {
  const template = getTemplate(templateId);
  if (template.engine !== "gotenberg-html") {
    throw new PdfTemplateImmutableError("Only HTML templates can be duplicated in the editor");
  }
  const revision = getRevision(template.currentRevisionId ?? 0);
  if (!revision.source) throw new PdfTemplateNotFoundError("Template source was not found");
  return createHtmlTemplate(name?.trim() || `${template.name} copy`, revision.source);
}

export function renderHtmlSample(source: string): string {
  validateHtml(source);
  return renderLiquidHtml(source, sampleInvoiceDocument);
}

export async function renderTemplateSamplePdf(templateId: number): Promise<Buffer> {
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
