/** @jsxImportSource react */
import { renderToBuffer } from "@react-pdf/renderer";
import { InvoiceDocument } from "./invoice-document.tsx";
import type { InvoicePdfViewModel } from "./view-model.ts";

/**
 * Render an invoice view model to PDF bytes. Isolated so callers (download
 * route, archive flow) depend on a single entry point rather than React PDF
 * internals.
 */
export async function renderInvoicePdfBuffer(
  data: InvoicePdfViewModel,
): Promise<Buffer> {
  return renderToBuffer(<InvoiceDocument data={data} />);
}
