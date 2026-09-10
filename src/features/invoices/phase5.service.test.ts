import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { db } from "../../db/client.ts";
import { eq } from "drizzle-orm";
import {
  clients,
  files,
  invoiceItems,
  invoiceSequences,
  invoices,
  notaFiscalLinks,
} from "../../db/schema.ts";
import { nowIso } from "../../domain/dates.ts";
import { absolutePath } from "../files/files.service.ts";
import { getFileById } from "../files/files.repository.ts";
import {
  archiveInvoicePdf,
  createInvoice,
  getInvoiceDetail,
  getInvoiceFile,
  linkNotaFiscal,
  renderInvoicePdf,
  issueInvoice,
} from "./invoices.service.ts";
import { createHtmlTemplate } from "../pdf-templates/pdf-templates.service.ts";
import { GotenbergConnectionError } from "../../pdf/html/gotenberg-client.ts";

function makeClient(): number {
  const now = nowIso();
  return db
    .insert(clients)
    .values({
      name: "London Co",
      code: `C${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      defaultCurrency: "GBP",
      defaultFixedMonthlyValue: 400000,
      numberingProfileId: 1,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get().id;
}

function newInvoice() {
  const clientId = makeClient();
  const inv = createInvoice({
    clientId,
    invoiceDate: "2026-06-30",
    currency: "GBP",
    manualNumber: undefined,
    notes: undefined,
    items: [
      {
        name: "Monthly software development services",
        value: "4000.00",
        source: "fixed_monthly",
        notes: undefined,
      },
    ],
  });
  return getInvoiceDetail(inv.id)!;
}

beforeEach(() => {
  db.delete(notaFiscalLinks).run();
  db.delete(invoiceItems).run();
  db.delete(invoices).run();
  db.delete(invoiceSequences).run();
  db.delete(clients).run();
  db.delete(files).run();
});

describe("renderInvoicePdf", () => {
  test("produces a non-empty PDF with the templated filename", async () => {
    const detail = newInvoice();
    const { buffer, filename } = await renderInvoicePdf(detail);
    expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(filename.endsWith(".pdf")).toBe(true);
  });

  test("dispatches an HTML revision through Gotenberg with the shared document model", async () => {
    const originalUrl = process.env.GOTENBERG_URL;
    const originalTimeout = process.env.GOTENBERG_TIMEOUT_MS;
    let renderedHtml = "";
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const form = await request.formData();
        const file = form.get("files");
        if (file instanceof File) renderedHtml = await file.text();
        return new Response("%PDF-1.7\nhtml-render", {
          headers: { "content-type": "application/pdf" },
        });
      },
    });
    try {
      process.env.GOTENBERG_URL = `http://127.0.0.1:${server.port}`;
      process.env.GOTENBERG_TIMEOUT_MS = "1000";
      const template = createHtmlTemplate(
        `HTML contract ${crypto.randomUUID()}`,
        "<!doctype html><html><head><title>Invoice</title></head><body>{{ customer.name }} — {{ invoice.number }} — {{ total.display }}</body></html>",
      );
      const detail = newInvoice();
      db.update(invoices)
        .set({ pdfTemplateRevisionId: template.currentRevisionId })
        .where(eq(invoices.id, detail.invoice.id))
        .run();

      const { buffer } = await renderInvoicePdf(getInvoiceDetail(detail.invoice.id)!);
      expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
      expect(renderedHtml).toContain("London Co");
      expect(renderedHtml).toContain(detail.invoice.number);
      expect(renderedHtml).toContain("£4,000.00");
    } finally {
      server.stop(true);
      if (originalUrl === undefined) delete process.env.GOTENBERG_URL;
      else process.env.GOTENBERG_URL = originalUrl;
      if (originalTimeout === undefined) delete process.env.GOTENBERG_TIMEOUT_MS;
      else process.env.GOTENBERG_TIMEOUT_MS = originalTimeout;
    }
  });
});

describe("archiveInvoicePdf", () => {
  test("writes a hashed archive and links it to the invoice", async () => {
    const detail = newInvoice();
    const file = await archiveInvoicePdf(detail);

    expect(file.kind).toBe("archived_invoice");
    expect(existsSync(absolutePath(file))).toBe(true);

    const updated = getInvoiceDetail(detail.invoice.id)!;
    expect(updated.invoice.archivedPdfFileId).toBe(file.id);
    expect(updated.archivedPdf!.sha256).toBe(file.sha256);
  });

  test("re-archiving supersedes the prior file instead of overwriting", async () => {
    const detail = newInvoice();
    const first = await archiveInvoicePdf(detail);
    const reloaded = getInvoiceDetail(detail.invoice.id)!;
    const second = await archiveInvoicePdf(reloaded);

    expect(second.id).not.toBe(first.id);
    expect(getFileById(first.id)!.supersededByFileId).toBe(second.id);
    expect(getInvoiceDetail(detail.invoice.id)!.invoice.archivedPdfFileId).toBe(
      second.id,
    );
    // Both archived files remain on disk.
    expect(existsSync(absolutePath(first))).toBe(true);
    expect(existsSync(absolutePath(second))).toBe(true);
  });

  test("refuses an obsolete archive request without selecting a PDF", async () => {
    const detail = newInvoice();
    db.update(invoices).set({ workspaceRevision: detail.invoice.workspaceRevision + 1, updatedAt: nowIso() }).where(eq(invoices.id, detail.invoice.id)).run();
    await expect(archiveInvoicePdf(detail)).rejects.toMatchObject({ code: "STALE_REVISION" });
    const current = getInvoiceDetail(detail.invoice.id)!;
    expect(current.invoice.archivedPdfFileId).toBeNull();
    expect(current.invoice.workspaceRevision).toBe(detail.invoice.workspaceRevision + 1);
  });

  test("a failed HTML render does not archive or advance issue status", async () => {
    const originalUrl = process.env.GOTENBERG_URL;
    const originalTimeout = process.env.GOTENBERG_TIMEOUT_MS;
    try {
      process.env.GOTENBERG_URL = "http://127.0.0.1:1";
      process.env.GOTENBERG_TIMEOUT_MS = "1000";
      const template = createHtmlTemplate(
        `Unavailable ${crypto.randomUUID()}`,
        "<!doctype html><html><head><title>Invoice</title></head><body>{{ invoice.number }}</body></html>",
      );
      const detail = newInvoice();
      db.update(invoices)
        .set({ pdfTemplateRevisionId: template.currentRevisionId })
        .where(eq(invoices.id, detail.invoice.id))
        .run();
      const htmlDetail = getInvoiceDetail(detail.invoice.id)!;

      await expect(issueInvoice(htmlDetail)).rejects.toBeInstanceOf(
        GotenbergConnectionError,
      );
      const unchanged = getInvoiceDetail(detail.invoice.id)!;
      expect(unchanged.invoice.status).toBe("draft");
      expect(unchanged.invoice.archivedPdfFileId).toBeNull();
    } finally {
      if (originalUrl === undefined) delete process.env.GOTENBERG_URL;
      else process.env.GOTENBERG_URL = originalUrl;
      if (originalTimeout === undefined) delete process.env.GOTENBERG_TIMEOUT_MS;
      else process.env.GOTENBERG_TIMEOUT_MS = originalTimeout;
    }
  });
});

describe("linkNotaFiscal", () => {
  test("saves metadata and attaches uploaded PDF/XML", () => {
    const detail = newInvoice();
    const updated = linkNotaFiscal(
      detail,
      {
        nfNumber: "2026/123",
        issueDate: "2026-07-01",
        verificationCode: "ABC",
        publicUrl: "https://nfse.example/123",
        notes: undefined,
      },
      {
        pdf: { bytes: new TextEncoder().encode("%PDF-x"), originalFilename: "nf.pdf" },
        xml: { bytes: new TextEncoder().encode("<nf/>"), originalFilename: "nf.xml" },
      },
    );

    const link = updated.notaFiscal!;
    expect(link.nfNumber).toBe("2026/123");
    expect(link.pdfFileId).not.toBeNull();
    expect(link.xmlFileId).not.toBeNull();
    expect(getFileById(link.pdfFileId!)!.kind).toBe("nfse_pdf");
    expect(getFileById(link.xmlFileId!)!.kind).toBe("nfse_xml");
  });

  test("updating metadata without new uploads keeps existing attachments", () => {
    const detail = newInvoice();
    const withFiles = linkNotaFiscal(
      detail,
      { nfNumber: "A", issueDate: undefined, verificationCode: undefined, publicUrl: undefined, notes: undefined },
      { pdf: { bytes: new TextEncoder().encode("%PDF-"), originalFilename: "a.pdf" } },
    );
    const pdfId = withFiles.notaFiscal!.pdfFileId;

    const after = linkNotaFiscal(withFiles, {
      nfNumber: "B",
      issueDate: undefined,
      verificationCode: undefined,
      publicUrl: undefined,
      notes: undefined,
    });
    expect(after.notaFiscal!.nfNumber).toBe("B");
    expect(after.notaFiscal!.pdfFileId).toBe(pdfId);
  });

  test("re-uploading supersedes the previous attachment", () => {
    const detail = newInvoice();
    const first = linkNotaFiscal(
      detail,
      { nfNumber: "A", issueDate: undefined, verificationCode: undefined, publicUrl: undefined, notes: undefined },
      { pdf: { bytes: new TextEncoder().encode("v1"), originalFilename: "a.pdf" } },
    );
    const oldPdfId = first.notaFiscal!.pdfFileId!;

    const second = linkNotaFiscal(
      first,
      { nfNumber: "A", issueDate: undefined, verificationCode: undefined, publicUrl: undefined, notes: undefined },
      { pdf: { bytes: new TextEncoder().encode("v2"), originalFilename: "a.pdf" } },
    );
    const newPdfId = second.notaFiscal!.pdfFileId!;

    expect(newPdfId).not.toBe(oldPdfId);
    expect(getFileById(oldPdfId)!.supersededByFileId).toBe(newPdfId);
  });
});

describe("getInvoiceFile", () => {
  test("returns files linked to the invoice and rejects others", () => {
    const detail = newInvoice();
    const linked = linkNotaFiscal(
      detail,
      { nfNumber: "A", issueDate: undefined, verificationCode: undefined, publicUrl: undefined, notes: undefined },
      { pdf: { bytes: new TextEncoder().encode("%PDF-"), originalFilename: "a.pdf" } },
    );
    const pdfId = linked.notaFiscal!.pdfFileId!;

    expect(getInvoiceFile(linked, pdfId)).not.toBeNull();
    expect(getInvoiceFile(linked, pdfId + 999)).toBeNull();
  });
});
