import type { PdfTemplateRevision } from "../db/schema.ts";
import type { InvoiceDocumentModel } from "./document-model.ts";

export type PdfEngine = "react-pdf" | "gotenberg-html";

export type PdfRenderRequest = {
  template: PdfTemplateRevision;
  document: InvoiceDocumentModel;
  traceId: string;
};

export interface PdfRenderer {
  readonly engine: PdfEngine;
  render(request: PdfRenderRequest): Promise<Buffer>;
}

export class PdfRendererUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfRendererUnavailableError";
  }
}
