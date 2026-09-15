import { renderInvoicePdfBuffer } from "./render.tsx";
import type { PdfEngine, PdfRenderRequest, PdfRenderer } from "./renderer.ts";
import { PdfRendererUnavailableError } from "./renderer.ts";
import { renderLiquidHtml, renderLiquidHtmlPackage } from "./html/liquid-engine.ts";
import { convertHtmlPackageToPdf, convertHtmlToPdf } from "./html/gotenberg-client.ts";
import { revisionHasTemplatePackage, templatePackageFromRevision } from "../domain/template-package.ts";

const reactPdfRenderer: PdfRenderer = {
  engine: "react-pdf",
  render: renderInvoicePdfBuffer,
};

const htmlRenderer: PdfRenderer = {
  engine: "gotenberg-html",
  async render(request) {
    // Legacy revisions predate packages. Preserve their original single-file
    // policy so historical documents do not become invalid retroactively.
    if (!revisionHasTemplatePackage(request.template.configurationJson)) {
      if (!request.template.source) throw new PdfRendererUnavailableError("HTML template source is missing");
      return convertHtmlToPdf(renderLiquidHtml(request.template.source, request.document), request.traceId);
    }
    const templatePackage = templatePackageFromRevision(
      request.template.source,
      request.template.configurationJson,
    );
    const rendered = renderLiquidHtmlPackage(templatePackage, request.document);
    return convertHtmlPackageToPdf(rendered, request.traceId);
  },
};

const renderers = new Map<PdfEngine, PdfRenderer>([
  [reactPdfRenderer.engine, reactPdfRenderer],
  [htmlRenderer.engine, htmlRenderer],
]);

export function rendererFor(engine: string): PdfRenderer {
  const renderer = renderers.get(engine as PdfEngine);
  if (!renderer) {
    throw new PdfRendererUnavailableError(
      `The ${engine} PDF renderer is not configured`,
    );
  }
  return renderer;
}

export function renderPdf(request: PdfRenderRequest): Promise<Buffer> {
  // Revisions intentionally carry only immutable rendering data. Resolve the
  // engine through their renderer key: all current built-ins are React PDF;
  // HTML revisions have source and no renderer key.
  const hasRendererKey = Boolean(request.template.rendererKey);
  const hasSource = Boolean(request.template.source);
  if (hasRendererKey === hasSource) {
    throw new PdfRendererUnavailableError(
      "PDF template revision has an invalid renderer/source configuration",
    );
  }
  const engine = hasRendererKey ? "react-pdf" : "gotenberg-html";
  return rendererFor(engine).render(request);
}
