import { describe, expect, it } from "bun:test";
import { createApp } from "./app.tsx";

const app = createApp();

describe("app foundation", () => {
  it("rejects cross-site mutations before processing form data", async () => {
    const res = await app.request("/clients", { method: "POST", headers: { Origin: "https://untrusted.example", "Sec-Fetch-Site": "cross-site" }, body: "name=unexpected" });
    expect(res.status).toBe(403);
  });

  it("allows same-origin proxy requests through to form validation", async () => {
    const res = await app.request("/clients", { method: "POST", headers: { Origin: "https://invoices.example", "Sec-Fetch-Site": "same-origin", "Content-Type": "application/x-www-form-urlencoded" }, body: "name=" });
    expect(res.status).toBe(422);
  });

  it("rejects oversized requests before multipart parsing", async () => {
    const res = await app.request("/clients", { method: "POST", headers: { "Content-Length": String(21 * 1024 * 1024) }, body: "oversized" });
    expect(res.status).toBe(413);
  });
  it("serves the health check", async () => {
    const res = await app.fetch(new Request("http://localhost/healthz"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("renders the dashboard with the full layout", async () => {
    const res = await app.fetch(new Request("http://localhost/"));
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("<!DOCTYPE html>");
    expect(body).toContain("<title>Overview");
    expect(body).toContain("<title>Overview · Pipa</title>");
    expect(body).toContain('href="/public/pipa-logo.svg"');
    expect(body).toContain('alt="Pipa"');
    expect(body).toContain("Invoicing workspace");
    expect(body).toContain("Personal Invoicing &amp; Paperwork Assistant");
  });

  it("serves the Pipa logo asset", async () => {
    const res = await app.fetch(new Request("http://localhost/public/pipa-logo.svg"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/svg+xml");
    expect(await res.text()).toContain("Pipa — kite banknote");
  });

  it("returns a bare fragment (no layout) for htmx requests", async () => {
    const res = await app.fetch(
      new Request("http://localhost/", {
        headers: { "HX-Request": "true" },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).not.toContain("<html");
    expect(body).toContain("Overview");
  });

  it("returns 404 for unknown routes", async () => {
    const res = await app.fetch(
      new Request("http://localhost/does-not-exist"),
    );
    expect(res.status).toBe(404);
  });
});

describe("party field editor", () => {
  it("client form uses section cards instead of legacy fixed document inputs", async () => {
    const res = await app.request("/clients/new");
    const html = await res.text();
    expect(html).toContain("Document fields");
    expect(html).toContain("Search fields across all categories");
    expect(html).toContain("Add field");
    expect(html).not.toContain('name="legalName"');
    expect(html).not.toContain('name="address"');
  });
});

describe("PDF template routes", () => {
  it("shows HTML templates and a distinct unconfigured engine state", async () => {
    const res = await app.request("/settings/pdf-templates?engine=gotenberg-html");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Classic HTML");
    expect(html).toContain("HTML PDF engine");
    expect(html).toContain("unconfigured");
    expect(html).toContain("React PDF remains available");
  });

  it("renders a React PDF sample and blocks HTML samples without configuration", async () => {
    const react = await app.request("/settings/pdf-templates/1/sample.pdf");
    expect(react.status).toBe(200);
    expect(react.headers.get("content-type")).toContain("application/pdf");
    expect(Buffer.from(await react.arrayBuffer()).subarray(0, 5).toString()).toBe("%PDF-");

    const html = await app.request("/settings/pdf-templates/2/sample.pdf");
    expect(html.status).toBe(503);
    expect(await html.text()).toContain("not configured");
  });

  it("exports HTML source and preserves an invalid import for correction", async () => {
    const exported = await app.request("/settings/pdf-templates/2/source");
    expect(exported.status).toBe(200);
    expect(exported.headers.get("content-disposition")).toContain(".liquid.html");
    expect(await exported.text()).toContain("<!doctype html>");

    const form = new FormData();
    form.set("file", new File(["<p>{{ customer.name }}</p>"], "broken.html"));
    const imported = await app.request("/settings/pdf-templates/import", {
      method: "POST",
      body: form,
    });
    expect(imported.status).toBe(422);
    const html = await imported.text();
    expect(html).toContain("broken");
    expect(html).toContain("complete document");
  });
});
