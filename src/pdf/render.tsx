/** @jsxImportSource react */
import { renderToBuffer } from "@react-pdf/renderer";
import { InvoiceDocument } from "./invoice-document.tsx";
import { classicViewModelFromDocument } from "./view-model.ts";
import type { PdfRenderRequest } from "./renderer.ts";
import { PdfRendererUnavailableError } from "./renderer.ts";

/**
 * Render an invoice view model to PDF bytes. Isolated so callers (download
 * route, archive flow) depend on a single entry point rather than React PDF
 * internals.
 */
export async function renderInvoicePdfBuffer(
  request: PdfRenderRequest,
): Promise<Buffer> {
  if (request.template.rendererKey !== "classic") {
    throw new PdfRendererUnavailableError(
      `Unknown React PDF renderer: ${request.template.rendererKey ?? "(none)"}`,
    );
  }
  return renderToBuffer(
    <InvoiceDocument data={classicViewModelFromDocument(request.document)} />,
  );
}
