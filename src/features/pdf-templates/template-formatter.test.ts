import { expect, test } from "bun:test";
import {
  formatTemplateSource,
  getFormatterForPath,
} from "./template-formatter.ts";

test("selects only supported template source formats", () => {
  expect(getFormatterForPath("invoice.HTML")).toBe("liquid-html");
  expect(getFormatterForPath("partial.liquid")).toBe("liquid-html");
  expect(getFormatterForPath("styles.css")).toBe("css");
  expect(getFormatterForPath("invoice.jsx")).toBe("javascript");
  expect(getFormatterForPath("invoice.tsx")).toBe("typescript");
  expect(getFormatterForPath("readme.md")).toBeUndefined();
});

test("formats minified TSX and keeps the result idempotent", async () => {
  const first = await formatTemplateSource({
    path: "invoice.tsx",
    source: 'export const Invoice=({name}:{name:string})=><section className="invoice"><h1>{name}</h1><p>Total</p></section>',
    cursorOffset: 0,
  });
  expect(first.source).toBe(`export const Invoice = ({ name }: { name: string }) => (
  <section className="invoice">
    <h1>{name}</h1>
    <p>Total</p>
  </section>
);
`);
  const second = await formatTemplateSource({
    path: "invoice.tsx",
    source: first.source,
    cursorOffset: first.cursorOffset,
  });
  expect(second.source).toBe(first.source);
});

test("formats TypeScript style modules and CSS", async () => {
  const styles = await formatTemplateSource({
    path: "styles.ts",
    source: 'export const colors={primary:"#0369a1",muted:"#64748b"}; export function amount(value:number){return value.toFixed(2)}',
    cursorOffset: 0,
  });
  expect(styles.source).toBe(`export const colors = { primary: "#0369a1", muted: "#64748b" };
export function amount(value: number) {
  return value.toFixed(2);
}
`);

  const css = await formatTemplateSource({
    path: "styles.css",
    source: ".invoice{color:red;margin:0  4px}@media print{.invoice{color:black}}",
    cursorOffset: 0,
  });
  expect(css.source).toBe(`.invoice {
  color: red;
  margin: 0 4px;
}
@media print {
  .invoice {
    color: black;
  }
}
`);
});

test("formats Liquid while preserving sensitive capture, raw, trim, pre, and inline content", async () => {
  const result = await formatTemplateSource({
    path: "index.liquid",
    source: '{% capture subject %}Invoice {{ invoice.number }}{% endcapture %}{% render "partial", invoice: invoice %}{% raw %}{{ keep }}{% endraw %}{%- if invoice.number -%}<pre>  fixed  </pre><span>inline</span>{%- endif -%}',
    cursorOffset: 0,
  });
  expect(result.source).toBe(`{% capture subject %}Invoice {{ invoice.number }}{% endcapture -%}
{%- render 'partial', invoice: invoice -%}
{% raw %}{{ keep }}{% endraw %}
{%- if invoice.number -%}
  <pre>  fixed  </pre>
  <span>inline</span>
{%- endif -%}
`);
});

test("returns a translated cursor offset", async () => {
  const source = "const total={amount:1}";
  const result = await formatTemplateSource({
    path: "invoice.ts",
    source,
    cursorOffset: source.indexOf("amount") + 3,
  });
  expect(result.cursorOffset).toBe(19);
  expect(result.source.slice(result.cursorOffset - 3, result.cursorOffset)).toBe("amo");
});

test("rejects invalid source without changing the caller's buffer", async () => {
  const source = "const = ;";
  await expect(
    formatTemplateSource({ path: "invoice.ts", source, cursorOffset: 0 }),
  ).rejects.toThrow();
  expect(source).toBe("const = ;");
  await expect(
    formatTemplateSource({ path: "notes.md", source: "text", cursorOffset: 0 }),
  ).rejects.toThrow("Formatting is not available");
});
