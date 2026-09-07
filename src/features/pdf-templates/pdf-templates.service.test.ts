import { describe, expect, test } from "bun:test";
import { db } from "../../db/client.ts";
import { clients, issuerSettings, pdfTemplates } from "../../db/schema.ts";
import { nowIso } from "../../domain/dates.ts";
import { LiquidSourceError } from "../../pdf/html/liquid-engine.ts";
import {
  createHtmlTemplate,
  getRevision,
  getTemplate,
  listTemplateRevisions,
  PdfEngineNotConfiguredError,
  resolveTemplateRevision,
  reviseHtmlTemplate,
  validateDefaultTemplate,
} from "./pdf-templates.service.ts";

const source = (body: string) =>
  `<!doctype html><html><head><title>Invoice</title></head><body>${body}</body></html>`;

describe("PDF template registry", () => {
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
