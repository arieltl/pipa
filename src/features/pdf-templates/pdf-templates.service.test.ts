import { describe, expect, test } from "bun:test";
import { db } from "../../db/client.ts";
import { clients, issuerSettings, pdfTemplateRevisions, pdfTemplates } from "../../db/schema.ts";
import { nowIso } from "../../domain/dates.ts";
import { LiquidSourceError } from "../../pdf/html/liquid-engine.ts";
import {
  createHtmlTemplate,
  getRevision,
  getRevisionPackage,
  getTemplate,
  listTemplateRevisions,
  PdfEngineNotConfiguredError,
  renderHtmlPreviewPdf,
  resolveTemplateRevision,
  reviseHtmlTemplate,
  validateDefaultTemplate,
} from "./pdf-templates.service.ts";

const source = (body: string) =>
  `<!doctype html><html><head><title>Invoice</title></head><body>${body}</body></html>`;

describe("PDF template registry", () => {
  test("rejects invalid transient preview source before it reaches a renderer", async () => {
    let rendered = false;
    await expect(
      renderHtmlPreviewPdf(
        source("{{ invoice.misspelled_number }}"),
        async () => {
          rendered = true;
          return Buffer.from("%PDF-preview");
        },
      ),
    ).rejects.toBeInstanceOf(LiquidSourceError);
    expect(rendered).toBe(false);
  });

  test("requires Gotenberg for transient previews", async () => {
    const originalUrl = process.env.GOTENBERG_URL;
    try {
      delete process.env.GOTENBERG_URL;
      await expect(renderHtmlPreviewPdf(source("Preview"))).rejects.toBeInstanceOf(
        PdfEngineNotConfiguredError,
      );
    } finally {
      if (originalUrl === undefined) delete process.env.GOTENBERG_URL;
      else process.env.GOTENBERG_URL = originalUrl;
    }
  });

  test("renders a transient revision without creating database rows", async () => {
    const originalUrl = process.env.GOTENBERG_URL;
    try {
      process.env.GOTENBERG_URL = "http://gotenberg.test:3000";
      const before = {
        templates: db.select().from(pdfTemplates).all().length,
        revisions: db.select().from(pdfTemplateRevisions).all().length,
      };
      let receivedSource = "";
      const pdf = await renderHtmlPreviewPdf(source("{{ invoice.number }}"), async (request) => {
        receivedSource = request.template.source ?? "";
        expect(request.template.id).toBe(0);
        expect(request.template.templateId).toBe(0);
        expect(request.template.rendererKey).toBeNull();
        expect(request.document).toHaveProperty("invoice.number");
        return Buffer.from("%PDF-preview");
      });

      expect(pdf.toString()).toBe("%PDF-preview");
      expect(receivedSource).toContain("{{ invoice.number }}");
      expect(db.select().from(pdfTemplates).all()).toHaveLength(before.templates);
      expect(db.select().from(pdfTemplateRevisions).all()).toHaveLength(before.revisions);
    } finally {
      if (originalUrl === undefined) delete process.env.GOTENBERG_URL;
      else process.env.GOTENBERG_URL = originalUrl;
    }
  });

  test("creates immutable sequential HTML revisions", () => {
    const template = createHtmlTemplate(
      `Revision test ${crypto.randomUUID()}`,
      source("Revision one"),
    );
    const first = getRevision(template.currentRevisionId!);
    const second = reviseHtmlTemplate(
      template.id,
      template.name,
      source("Revision two"),
    );

    expect(first.revision).toBe(1);
    expect(second.revision).toBe(2);
    expect(getRevision(first.id).source).toContain("Revision one");
    expect(getTemplate(template.id).currentRevisionId).toBe(second.id);
    expect(listTemplateRevisions(template.id).map((item) => item.revision)).toEqual([2, 1]);
  });

  test("stores the entire package in an immutable revision and adapts legacy source rows", () => {
    const firstPackage = {
      version: 1 as const,
      entry: "index.html" as const,
      files: [
        { path: "index.html", content: source('<link rel="stylesheet" href="styles/a.css">'), encoding: "utf8" as const },
        { path: "styles/a.css", content: "body { color: navy }", encoding: "utf8" as const },
      ],
    };
    const template = createHtmlTemplate(`Package ${crypto.randomUUID()}`, firstPackage.files[0]!.content, firstPackage);
    const first = getRevision(template.currentRevisionId!);
    expect(getRevisionPackage(first).files).toHaveLength(2);
    const second = reviseHtmlTemplate(template.id, template.name, source("Second"));
    expect(getRevisionPackage(first).files.find((file) => file.path === "styles/a.css")?.content).toContain("navy");
    expect(getRevisionPackage(second).files).toEqual([{ path: "index.html", content: source("Second"), encoding: "utf8" }]);
    const legacy = { ...second, configurationJson: "{}" };
    expect(getRevisionPackage(legacy).files[0]?.content).toContain("Second");
  });

  test("validates complete Liquid HTML before creating a revision", () => {
    expect(() => createHtmlTemplate("Invalid", "<p>{{ customer.name }}</p>")).toThrow(
      LiquidSourceError,
    );
  });

  test("resolves explicit, client, issuer, then built-in precedence", () => {
    const originalUrl = process.env.GOTENBERG_URL;
    try {
      process.env.GOTENBERG_URL = "http://gotenberg.test:3000";
      const html = createHtmlTemplate(
        `Precedence ${crypto.randomUUID()}`,
        source("{{ invoice.number }}"),
      );
      const classic = db
        .select()
        .from(pdfTemplates)
        .all()
        .find((template) => template.stableKey === "builtin-react-classic")!;
      const now = nowIso();
      const client = db
        .insert(clients)
        .values({
          name: "Template client",
          code: `T${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
          defaultCurrency: "GBP",
          defaultPdfTemplateId: html.id,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();
      const issuer = db
        .insert(issuerSettings)
        .values({
          name: "Template issuer",
          defaultCurrency: "GBP",
          defaultPdfTemplateId: classic.id,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();

      expect(resolveTemplateRevision(client, issuer).templateId).toBe(html.id);
      expect(resolveTemplateRevision(client, issuer, classic.id).templateId).toBe(classic.id);
      expect(resolveTemplateRevision({ ...client, defaultPdfTemplateId: null }, issuer).templateId).toBe(classic.id);
    } finally {
      if (originalUrl === undefined) delete process.env.GOTENBERG_URL;
      else process.env.GOTENBERG_URL = originalUrl;
    }
  });

  test("HTML templates are editable but cannot be selected while unconfigured", () => {
    const originalUrl = process.env.GOTENBERG_URL;
    try {
      delete process.env.GOTENBERG_URL;
      const html = createHtmlTemplate(
        `Offline editing ${crypto.randomUUID()}`,
        source("Offline source"),
      );
      expect(getRevision(html.currentRevisionId!).source).toContain("Offline source");
      expect(() => validateDefaultTemplate(html.id)).toThrow(PdfEngineNotConfiguredError);
    } finally {
      if (originalUrl !== undefined) process.env.GOTENBERG_URL = originalUrl;
    }
  });
});
