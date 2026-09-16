import { afterEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { clients } from "../../db/schema.ts";
import { nowIso } from "../../domain/dates.ts";
import { renderLiquidPlainText } from "../../pdf/html/liquid-engine.ts";
import { renderReactTemplatePackage } from "../../pdf/react-template-renderer.tsx";
import { createApp } from "../../app.tsx";
import { PreviewDataError, parsePreviewData, resolvePreviewData } from "./preview-data.ts";

const created: number[] = [];
const app = createApp();
afterEach(() => { for (const id of created.splice(0)) db.delete(clients).where(eq(clients.id, id)).run(); });

function client() {
  const now = nowIso();
  const row = db.insert(clients).values({ name: "Preview client", code: `P${crypto.randomUUID().slice(0, 8)}`, defaultCurrency: "GBP", partyFieldsJson: JSON.stringify([
    { key: "purchase_order", definitionKey: null, label: "Purchase order", value: "", section: "other", visibility: "document", position: 0 },
    { key: "internal_note", definitionKey: null, label: "Internal", value: "secret", section: "other", visibility: "internal", position: 1 },
  ]), createdAt: now, updatedAt: now }).returning().get();
  created.push(row.id); return row;
}

describe("template preview data", () => {
  test("resolves a selected client, configured blank custom fields, preview-only definitions, and safe overrides", () => {
    const selected = client();
    const result = resolvePreviewData({ issuerSource: "empty", customerSource: "client", customerClientId: selected.id, invoiceSource: "sample", customFieldDefinitions: [{ party: "customer", key: "project_name", label: "Project name", section: "other" }], overrides: { "customer.field.purchase_order.value": "PO-7", "customer.field.project_name.value": "Atlas", "items.0.valueMinor": "2500" } });
    expect(result.document.customer.name).toBe("Preview client");
    expect(result.document.customer.field.purchase_order?.value).toBe("PO-7");
    expect(result.document.customer.field.project_name?.value).toBe("Atlas");
    expect(result.document.customer.fields.find((field) => field.key === "purchase_order")).toBe(result.document.customer.sections.other.find((field) => field.key === "purchase_order"));
    expect(result.document.customer.field.internal_note).toBeUndefined();
    expect(result.document.total.minor).toBe(2500);
    expect(result.fields.map((field) => field.path)).toContain("customer.field.project_name.value");
    expect(result.fields.find((field) => field.path === "customer.field.purchase_order.value")?.value).toBe("");
    expect(JSON.parse(db.select().from(clients).where(eq(clients.id, selected.id)).get()!.partyFieldsJson)[0].value).toBe("");
  });

  test("empty invoice stays structurally valid and selected stale clients are explicit", () => {
    const empty = resolvePreviewData({ issuerSource: "empty", customerSource: "empty", invoiceSource: "empty" });
    expect(empty.document.items).toEqual([]); expect(empty.document.records).toEqual([]);
    expect(empty.document.total).toEqual({ minor: 0, decimal: "", display: "" }); expect(empty.document.invoice.dateIso).toBe(""); expect(empty.document.invoice.currency).toBe("");
    expect(() => resolvePreviewData({ customerSource: "client", customerClientId: 99999999 })).toThrow(PreviewDataError);
  });

  test("uses explicitly configured preview line items as a transient replacement and recalculates totals", () => {
    const configured = resolvePreviewData({
      invoiceSource: "sample",
      items: [{ name: "Discovery", valueMinor: 1250 }, { name: "Implementation", valueMinor: 8750 }],
    });
    expect(configured.config.items).toEqual([{ name: "Discovery", valueMinor: 1250 }, { name: "Implementation", valueMinor: 8750 }]);
    expect(configured.document.items.map(({ name, valueMinor }) => ({ name, valueMinor }))).toEqual([
      { name: "Discovery", valueMinor: 1250 }, { name: "Implementation", valueMinor: 8750 },
    ]);
    expect(configured.document.total.minor).toBe(10000);
    expect(configured.document.total.decimal).toBe("100.00");
    expect(configured.fields.map((field) => field.path)).toEqual(expect.arrayContaining(["items.0.name", "items.0.valueMinor", "items.1.name", "items.1.valueMinor"]));
    expect(resolvePreviewData({ invoiceSource: "sample" }).document.items.map(({ name, valueMinor }) => ({ name, valueMinor }))).toEqual([
      { name: "Software development services", valueMinor: 100000 },
    ]);

    const removed = resolvePreviewData({ invoiceSource: "sample", items: [] });
    expect(removed.config.items).toEqual([]);
    expect(removed.document.items).toEqual([]);
    expect(removed.document.total.minor).toBe(0);
    expect(removed.document.total.decimal).toBe("0.00");
  });

  test("omitted items follow their source while explicit rows work with an empty invoice source", () => {
    const sample = resolvePreviewData({ invoiceSource: "sample" });
    expect(sample.config.items).toBeUndefined();
    expect(sample.document.items).toHaveLength(1);

    const empty = resolvePreviewData({ invoiceSource: "empty" });
    expect(empty.config.items).toBeUndefined();
    expect(empty.document.items).toEqual([]);
    expect(empty.document.total).toEqual({ minor: 0, decimal: "", display: "" });

    const explicit = resolvePreviewData({ invoiceSource: "empty", items: [{ name: "Standalone", valueMinor: 4242 }] });
    expect(explicit.document.items.map(({ name, valueMinor }) => ({ name, valueMinor }))).toEqual([{ name: "Standalone", valueMinor: 4242 }]);
    expect(explicit.document.total.minor).toBe(4242);
    expect(explicit.document.total.decimal).toBe("42.42");
  });

  test("applies item overrides after configured rows and bounds item input", () => {
    const overridden = resolvePreviewData({ items: [{ name: "Original", valueMinor: 500 }], overrides: { "items.0.name": "Changed", "items.0.valueMinor": "750" } });
    expect(overridden.document.items[0]).toMatchObject({ name: "Changed", valueMinor: 750 });
    expect(overridden.document.total.minor).toBe(750);
    expect(() => resolvePreviewData({ items: [{ name: "Bad", valueMinor: -1 }] })).toThrow();
    expect(() => resolvePreviewData({ items: [{ name: "Bad", valueMinor: 1.5 }] })).toThrow();
    expect(() => resolvePreviewData({ items: [{ name: "Bad", valueMinor: Number.MAX_SAFE_INTEGER + 1 }] })).toThrow();
    expect(() => resolvePreviewData({ items: Array.from({ length: 101 }, () => ({ name: "Too many", valueMinor: 0 })) })).toThrow();
    expect(() => resolvePreviewData({ items: [{ name: "x".repeat(501), valueMinor: 0 }] })).toThrow();
    expect(() => parsePreviewData(JSON.stringify({ version: 1, items: [{ name: "Bad", valueMinor: 1, constructor: "pollute" }] }))).toThrow(PreviewDataError);
    expect(() => parsePreviewData('{"version":1,"items":[{"name":"Bad","valueMinor":1,"__proto__":"pollute"}]}')).toThrow(PreviewDataError);
  });

  test("rejects unsafe or unknown override paths", () => {
    expect(() => parsePreviewData(JSON.stringify({ version: 1, overrides: { "customer.__proto__.value": "x" } }))).toThrow(PreviewDataError);
    expect(() => resolvePreviewData({ overrides: { "customer.field.nope.value": "x" } })).toThrow("not allowed");
    expect(() => resolvePreviewData({ overrides: { "invoice.dateIso": "2026-02-30" } })).toThrow("valid YYYY-MM-DD");
    expect(() => resolvePreviewData({ overrides: { "invoice.currency": "XYZ" } })).toThrow("supported currency");
    expect(resolvePreviewData({ overrides: { "items.0.valueMinor": "" } }).document.total.minor).toBe(0);
  });

  test("resolves the editable catalog through a no-store body endpoint and reports stale clients", async () => {
    const response = await app.request("/settings/pdf-templates/preview-data", { method: "POST", body: new URLSearchParams({ previewData: JSON.stringify({ version: 1, customerSource: "empty", customFieldDefinitions: [{ party: "customer", key: "reference", label: "Reference", section: "other" }] }) }) });
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    expect((await response.json() as { fields: Array<{ path: string }> }).fields.map((field) => field.path)).toContain("customer.field.reference.value");
    const stale = await app.request("/settings/pdf-templates/preview-data", { method: "POST", body: new URLSearchParams({ previewData: JSON.stringify({ version: 1, customerSource: "client", customerClientId: 99999999 }) }) });
    expect(stale.status).toBe(422); expect(await stale.text()).toContain("no longer exists");
    const invalid = await app.request("/settings/pdf-templates/preview-data", { method: "POST", body: new URLSearchParams({ previewData: JSON.stringify({ version: 1, customFieldDefinitions: [{ party: "customer", key: "__proto__", label: "Bad", section: "other" }] }) }) });
    expect(invalid.status).toBe(422);
  });

  test("both engines receive optional custom-field defaults without changing strict rendering", async () => {
    const document = resolvePreviewData({ customerSource: "empty", customFieldDefinitions: [{ party: "customer", key: "optional_custom", label: "Optional", section: "other" }] }).document;
    expect(renderLiquidPlainText("{{ customer.field.optional_custom.value | default: 'Fallback' }}", document)).toBe("Fallback");
    const pdf = await renderReactTemplatePackage({ version: 1, entry: "index.tsx", files: [{ path: "index.tsx", encoding: "utf8", content: 'import { Document, Page, Text } from "@react-pdf/renderer"; export default function Template({ document }) { return <Document><Page><Text>{document.customer.field.optional_custom?.value || "Fallback"}</Text></Page></Document>; }' }] }, document);
    expect(pdf.byteLength).toBeGreaterThan(100);
  });
});
