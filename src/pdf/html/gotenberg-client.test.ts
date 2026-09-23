import { afterEach, describe, expect, test } from "bun:test";
import type { GotenbergConfig } from "../../config/gotenberg.ts";
import {
  checkGotenbergHealth,
  convertHtmlToPdf,
  convertHtmlPackageToPdf,
  flattenPackageForGotenberg,
  GotenbergConnectionError,
  GotenbergInvalidPdfError,
  GotenbergInvalidResponseError,
  GotenbergRequestError,
  GotenbergTimeoutError,
  GotenbergUnavailableError,
} from "./gotenberg-client.ts";

const servers: Array<ReturnType<typeof Bun.serve>> = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
});

function fakeServer(fetch: (request: Request) => Response | Promise<Response>) {
  const server = Bun.serve({ port: 0, fetch });
  servers.push(server);
  return server;
}

function configFor(
  server: ReturnType<typeof Bun.serve>,
  overrides: Partial<GotenbergConfig> = {},
): GotenbergConfig {
  return {
    url: `http://127.0.0.1:${server.port}`,
    timeoutMs: 1_000,
    maxResponseBytes: 1024 * 1024,
    ...overrides,
  };
}

describe("Gotenberg client", () => {
  test("posts index.html, print options, and the trace header", async () => {
    let receivedTrace = "";
    let receivedFileName = "";
    let receivedFileText = "";
    let printBackground = "";
    let preferCssPageSize = "";
    const server = fakeServer(async (request) => {
      expect(new URL(request.url).pathname).toBe("/forms/chromium/convert/html");
      receivedTrace = request.headers.get("Gotenberg-Trace") ?? "";
      const form = await request.formData();
      const file = form.get("files");
      if (file instanceof File) {
        receivedFileName = file.name;
        receivedFileText = await file.text();
      }
      printBackground = String(form.get("printBackground"));
      preferCssPageSize = String(form.get("preferCssPageSize"));
      return new Response("%PDF-1.7\nexample", {
        headers: { "content-type": "application/pdf" },
      });
    });

    const result = await convertHtmlToPdf(
      "<!doctype html><html><body>Hello</body></html>",
      "invoice-trace-123",
      {},
      configFor(server),
    );

    expect(result.subarray(0, 5).toString()).toBe("%PDF-");
    expect(receivedTrace).toBe("invoice-trace-123");
    expect(receivedFileName).toBe("index.html");
    expect(receivedFileText).toContain("<body>Hello</body>");
    expect(printBackground).toBe("true");
    expect(preferCssPageSize).toBe("true");
  });

  test("maps 4xx and 5xx responses separately", async () => {
    let status = 400;
    const server = fakeServer(() => new Response("conversion failed", { status }));
    const config = configFor(server);

    await expect(convertHtmlToPdf("<html></html>", "trace", {}, config)).rejects.toBeInstanceOf(
      GotenbergRequestError,
    );
    status = 503;
    await expect(convertHtmlToPdf("<html></html>", "trace", {}, config)).rejects.toBeInstanceOf(
      GotenbergUnavailableError,
    );
  });

  test("posts every local package asset in the same multipart request", async () => {
    const names: string[] = [];
    const server = fakeServer(async (request) => {
      const form = await request.formData();
      for (const file of form.getAll("files")) if (file instanceof File) names.push(file.name);
      return new Response("%PDF-1.7\nexample", { headers: { "content-type": "application/pdf" } });
    });
    await convertHtmlPackageToPdf({
      version: 1,
      entry: "index.html",
      files: [
        { path: "index.html", content: "<!doctype html><html><body>Invoice</body></html>", encoding: "utf8" },
        { path: "styles/invoice.css", content: "body { color: navy }", encoding: "utf8" },
        { path: "images/logo.png", content: "iVBORw0KGgoAAAANSUhEUg==", encoding: "base64" },
      ],
    }, "trace", {}, configFor(server));
    expect(names).toHaveLength(3);
    expect(names[0]).toBe("index.html");
    expect(names[1]).toMatch(/^[a-f0-9]+-invoice-css\.css$/);
    expect(names[2]).toMatch(/^[a-f0-9]+-logo-png\.png$/);
  });

  test("rewrites CSS import paths without dropping media qualifiers", () => {
    const flattened = flattenPackageForGotenberg({
      version: 1,
      entry: "index.html",
      files: [
        { path: "index.html", content: "<!doctype html><html><head><link rel=\"stylesheet\" href=\"styles/main.css\"></head><body></body></html>", encoding: "utf8" },
        { path: "styles/main.css", content: "@import url('print.css') print; @import 'screen.css' screen;", encoding: "utf8" },
        { path: "styles/print.css", content: "body{color:black}", encoding: "utf8" },
        { path: "styles/screen.css", content: "body{color:navy}", encoding: "utf8" },
      ],
    });
    const css = flattened.files.find((file) => file.content.includes("@import"))!.content;
    expect(css).toContain("print");
    expect(css).toContain("screen");
    expect(css).not.toContain("print.css");
    expect(css).not.toContain("screen.css");
  });

  test("maps timeout and connection failures", async () => {
    const slow = fakeServer(
      () => new Promise((resolve) => setTimeout(() => resolve(new Response("late")), 100)),
    );
    await expect(
      convertHtmlToPdf("<html></html>", "trace", {}, configFor(slow, { timeoutMs: 10 })),
    ).rejects.toBeInstanceOf(GotenbergTimeoutError);

    await expect(
      convertHtmlToPdf("<html></html>", "trace", {}, {
        url: "http://127.0.0.1:1",
        timeoutMs: 100,
        maxResponseBytes: 1024,
      }),
    ).rejects.toBeInstanceOf(GotenbergConnectionError);
  });

  test("rejects non-PDF and oversized successful responses", async () => {
    const invalid = fakeServer(() =>
      new Response("not a pdf", { headers: { "content-type": "application/pdf" } }),
    );
    await expect(
      convertHtmlToPdf("<html></html>", "trace", {}, configFor(invalid)),
    ).rejects.toBeInstanceOf(GotenbergInvalidPdfError);

    const oversized = fakeServer(() =>
      new Response("%PDF-" + "x".repeat(50), {
        headers: { "content-type": "application/pdf" },
      }),
    );
    await expect(
      convertHtmlToPdf(
        "<html></html>",
        "trace",
        {},
        configFor(oversized, { maxResponseBytes: 10 }),
      ),
    ).rejects.toBeInstanceOf(GotenbergInvalidResponseError);
  });

  test("reports health independently from configuration", async () => {
    const server = fakeServer((request) =>
      new URL(request.url).pathname === "/health"
        ? Response.json({ status: "up" })
        : new Response("missing", { status: 404 }),
    );
    expect(await checkGotenbergHealth(configFor(server))).toBe("healthy");
    expect(await checkGotenbergHealth(null)).toBe("unconfigured");
  });
});

const integrationUrl = process.env.GOTENBERG_INTEGRATION_URL?.trim();
(integrationUrl ? test : test.skip)(
  "real Gotenberg conversion (opt in with GOTENBERG_INTEGRATION_URL)",
  async () => {
    const pdf = await convertHtmlToPdf(
      "<!doctype html><html><head><title>Test</title></head><body>Invoice test</body></html>",
      crypto.randomUUID(),
      {},
      {
        url: integrationUrl!,
        timeoutMs: 15_000,
        maxResponseBytes: 5 * 1024 * 1024,
      },
    );
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  },
);

(integrationUrl ? test : test.skip)(
  "real Gotenberg renders flattened nested CSS assets",
  async () => {
    const pdf = await convertHtmlPackageToPdf(
      {
        version: 1,
        entry: "index.html",
        files: [
          { path: "index.html", content: "<!doctype html><html><head><link rel=\"stylesheet\" href=\"styles/invoice.css\"></head><body><img class=\"logo\" src=\"images/logo.png\">Invoice</body></html>", encoding: "utf8" },
          { path: "styles/invoice.css", content: ".logo { background-image: url('../images/logo.png'); width: 10px; height: 10px }", encoding: "utf8" },
          { path: "images/logo.png", content: "iVBORw0KGgoAAAANSUhEUg==", encoding: "base64" },
        ],
      },
      crypto.randomUUID(),
      {},
      { url: integrationUrl!, timeoutMs: 15_000, maxResponseBytes: 5 * 1024 * 1024 },
    );
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  },
);
