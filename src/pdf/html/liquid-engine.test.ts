import { describe, expect, test } from "bun:test";
import type { InvoiceDocumentModel } from "../document-model.ts";
import {
  LiquidSourceError,
  renderLiquidPlainText,
  renderLiquidHtml,
  validateLiquidHtmlSource,
  validateLiquidSource,
} from "./liquid-engine.ts";

const document = {
  issuer: { name: "A & B", fields: [], field: {}, sections: { identity: [], contact: [], address: [], payment: [], other: [] } },
  customer: {
    name: "Example <Co>",
    code: "EX",
    fields: [{ key: "vat", label: "VAT", value: "GB123" }],
    field: { vat: { key: "vat", label: "VAT", value: "GB123" } },
    sections: { identity: [{ key: "vat", label: "VAT", value: "GB123" }], contact: [], address: [], payment: [], other: [] },
  },
  invoice: { number: "INV-1", dateIso: "2026-06-30", dateDisplay: "30/06/2026", dateYear: "2026", dateMonth: "06", currency: "GBP", notes: null },
  items: [{ name: "Build & test", valueMinor: 10000, valueDisplay: "£100.00" }],
  total: { minor: 10000, decimal: "100.00", display: "£100.00" },
  records: [],
  notaFiscal: null,
} satisfies InvoiceDocumentModel;

describe("plain-text Liquid", () => {
  test("renders literal Unicode, loops, maps, and conditionals", () => {
    const source = `{% if customer.code %}{{ customer.name }}{% endif %}\n{% for field in customer.sections.identity %}{{ field.label }}: {{ field.value }}{% endfor %}\n{{ items[0].name }}`;
    expect(renderLiquidPlainText(source, document)).toBe(
      "Example <Co>\nVAT: GB123\nBuild & test",
    );
  });

  test("rejects unknown paths and file-loading tags", () => {
    expect(() => renderLiquidPlainText("{{ customer.naem }}", document)).toThrow(LiquidSourceError);
    expect(() => validateLiquidSource("{% include 'secret' %}")).toThrow(
      "not allowed",
    );
  });

  test("HTML mode requires a complete document and escapes values", () => {
    const source = "<!doctype html><html><head><title>Invoice</title></head><body>{{ customer.name }}</body></html>";
    expect(renderLiquidHtml(source, document)).toContain("Example &lt;Co&gt;");
    expect(() => validateLiquidHtmlSource("<p>{{ customer.name }}</p>")).toThrow(
      "complete document",
    );
  });

  test("HTML mode rejects remote resources and permits small data images", () => {
    expect(() =>
      validateLiquidHtmlSource(
        '<!doctype html><html><head><title>x</title></head><body><img src="https://example.test/logo.png"></body></html>',
      ),
    ).toThrow("self-contained data:image");
    expect(() =>
      validateLiquidHtmlSource(
        '<!doctype html><html><head><title>x</title><style>body{background:url(https://example.test/x)}</style></head><body></body></html>',
      ),
    ).toThrow("self-contained data URLs");
    expect(() =>
      validateLiquidHtmlSource(
        '<!doctype html><html><head><title>x</title></head><body><img src="data:image/png;base64,AA=="></body></html>',
      ),
    ).not.toThrow();
  });
});
