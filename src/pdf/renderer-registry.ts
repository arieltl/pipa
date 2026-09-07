import { renderInvoicePdfBuffer } from "./render.tsx";
import type { PdfEngine, PdfRenderRequest, PdfRenderer } from "./renderer.ts";
import { PdfRendererUnavailableError } from "./renderer.ts";
import { renderLiquidHtml } from "./html/liquid-engine.ts";
import { convertHtmlToPdf } from "./html/gotenberg-client.ts";

const reactPdfRenderer: PdfRenderer = {
  engine: "react-pdf",
  render: renderInvoicePdfBuffer,
};

const htmlRenderer: PdfRenderer = {
  engine: "gotenberg-html",
  async render(request) {
    if (!request.template.source) {
      throw new PdfRendererUnavailableError("HTML template source is missing");
    }
    const html = renderLiquidHtml(request.template.source, request.document);
    return convertHtmlToPdf(html, request.traceId);
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
