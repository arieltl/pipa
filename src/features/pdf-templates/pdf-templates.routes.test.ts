import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createApp } from "../../app.tsx";
import { db } from "../../db/client.ts";
import { files, invoices, pdfTemplateRevisions, pdfTemplates } from "../../db/schema.ts";

const app = createApp();
const servers: Array<ReturnType<typeof Bun.serve>> = [];
let inheritedGotenbergUrl: string | undefined;

beforeEach(() => {
  inheritedGotenbergUrl = process.env.GOTENBERG_URL;
  delete process.env.GOTENBERG_URL;
});

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
  if (inheritedGotenbergUrl === undefined) delete process.env.GOTENBERG_URL;
  else process.env.GOTENBERG_URL = inheritedGotenbergUrl;
});

const source = (body: string) =>
  `<!doctype html><html><head><title>Preview</title></head><body>${body}</body></html>`;

async function preview(sourceValue: string): Promise<Response> {
  return await app.request("/settings/pdf-templates/preview.pdf", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ source: sourceValue }),
  });
}

async function previewPackage(templatePackage: unknown): Promise<Response> {
  return await app.request("/settings/pdf-templates/preview.pdf", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ packageJson: JSON.stringify(templatePackage) }),
  });
}

describe("HTML template preview route", () => {
  test("rejects missing, empty, and overlong source at the route boundary", async () => {
    const missing = await app.request("/settings/pdf-templates/preview.pdf", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(),
    });
    const empty = await preview("");
    const overlong = await preview("x".repeat(204_801));

    for (const response of [missing, empty, overlong]) {
      expect(response.status).toBe(422);
      expect(response.headers.get("content-type")).toContain("text/plain");
    }
    expect(await missing.text()).toContain("HTML source or a template package is required");
    expect(await empty.text()).toContain("HTML source is required");
    expect(await overlong.text()).toContain("204,800");
  });

  test("returns validation errors as plain text before attempting a render", async () => {
    const response = await preview(source("{{ invoice.not_a_field }}"));

    expect(response.status).toBe(422);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(await response.text()).toContain("not_a_field");
  });

  test("reports an unavailable HTML renderer", async () => {
    const response = await preview(source("Preview"));

    expect(response.status).toBe(503);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(await response.text()).toContain("not configured");
  });

  test("accepts a package-only preview request and reports invalid package references", async () => {
    const valid = await previewPackage({
      version: 1,
      entry: "index.html",
      files: [{ path: "index.html", content: source("Preview"), encoding: "utf8" }],
    });
    expect(valid.status).toBe(503);
    const invalid = await previewPackage({
      version: 1,
      entry: "index.html",
      files: [{ path: "index.html", content: source('<img src="https://example.test/logo.png">'), encoding: "utf8" }],
    });
    expect(invalid.status).toBe(422);
    expect(await invalid.text()).toContain("External");
  });

  test("reports renderer failures as plain text", async () => {
    const renderer = Bun.serve({
      port: 0,
      fetch: () => new Response("renderer unavailable", { status: 503 }),
    });
    servers.push(renderer);
    process.env.GOTENBERG_URL = `http://127.0.0.1:${renderer.port}`;

    const response = await preview(source("Preview"));

    expect(response.status).toBe(503);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(await response.text()).toContain("Gotenberg returned 503");
  });

  test("returns a no-store PDF from a mock renderer without persistence", async () => {
    const renderer = Bun.serve({
      port: 0,
      fetch: async (request) => {
        expect(new URL(request.url).pathname).toBe("/forms/chromium/convert/html");
        const form = await request.formData();
        const file = form.get("files");
        expect(file).toBeInstanceOf(File);
        expect(await (file as File).text()).toContain("EXAMPLE-202609-01");
        return new Response("%PDF-1.7\\npreview", {
          headers: { "content-type": "application/pdf" },
        });
      },
    });
    servers.push(renderer);
    process.env.GOTENBERG_URL = `http://127.0.0.1:${renderer.port}`;
    const before = {
      templates: db.select().from(pdfTemplates).all().length,
      revisions: db.select().from(pdfTemplateRevisions).all().length,
      invoices: db.select().from(invoices).all().length,
      files: db.select().from(files).all().length,
    };

    const response = await preview(source("{{ invoice.number }}"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/pdf");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(Buffer.from(await response.arrayBuffer()).subarray(0, 5).toString()).toBe("%PDF-");
    expect(db.select().from(pdfTemplates).all()).toHaveLength(before.templates);
    expect(db.select().from(pdfTemplateRevisions).all()).toHaveLength(before.revisions);
    expect(db.select().from(invoices).all()).toHaveLength(before.invoices);
    expect(db.select().from(files).all()).toHaveLength(before.files);
  });
});
