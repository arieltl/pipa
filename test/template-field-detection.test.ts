import { expect, test } from "bun:test";
import { detectTemplatePartyFields } from "../assets/template-field-detection.ts";
import { classicEditableReactSource } from "../src/pdf/classic-react-template-source.ts";
import type { TemplatePackage } from "../src/domain/template-package.ts";

const pkg = (source: string, react = false, more: Record<string, string> = {}): TemplatePackage => ({
  version: 1, entry: react ? "index.tsx" : "index.html",
  files: Object.entries({ [react ? "index.tsx" : "index.html"]: source, ...more }).map(([path, content]) => ({ path, content, encoding: "utf8" })),
});
const keys = (value: ReturnType<typeof detectTemplatePartyFields>) => value.map((field) => `${field.party}.${field.key}`);

test("discovers Liquid literal custom fields, aliases, and partial arguments without string/comment false positives", () => {
  const input = pkg(`{{ customer.field.project_reference.value | default: 'issuer.field.fake.value' }}
{% assign seller = issuer %}{{ seller.field['bank_name'].value }}
{% render 'parts/header.liquid', business: seller %}
{% render 'parts/header.liquid', business: customer %}
{% comment %}{{ customer.field.ignored.value }}{% endcomment %}
{% raw %}{{ issuer.field.ignored.value }}{% endraw %}
{{ customer.field[dynamic_key].value }}`, false, { "parts/header.liquid": `{{ business.field.vat.value | default: 'VAT' }}` });
  expect(keys(detectTemplatePartyFields(input, "gotenberg-html"))).toEqual(["customer.project_reference", "customer.vat", "issuer.bank_name", "issuer.vat"]);
});

test("discovers React optional/bracket references, destructured document aliases, and literal helper keys", () => {
  const input = pkg(`function fieldValue(party, key) { return party.field[key]?.value ?? null; }
export default function Template({document: doc}) {
 const typedDoc: InvoiceDocument = doc;
 const { customer: buyer } = typedDoc;
 const issuerField = (key) => fieldValue(document.issuer, key);
 const key = "cost_center";
 // document.customer.field.fake.value
 const text = "document.issuer.field.fake.value";
 return <Text>{buyer?.field?.["project_reference"]?.value}{issuerField("tax_id")}{document.customer.field[key].value}</Text>;
}`, true);
  expect(keys(detectTemplatePartyFields(input, "react-pdf"))).toEqual(["customer.cost_center", "customer.project_reference", "issuer.tax_id"]);
});

test("discovers Classic's field helper calls and deduplicates references across files", () => {
  const fields = keys(detectTemplatePartyFields(pkg(classicEditableReactSource, true, { "part.tsx": "document.customer.field.legal_name?.value" }), "react-pdf"));
  expect(fields).toContain("issuer.legal_name");
  expect(fields).toContain("issuer.bank_name");
  expect(fields).toContain("customer.legal_name");
  expect(fields.filter((field) => field === "customer.legal_name")).toHaveLength(1);
});

test("does not invent invoice/item custom fields or unsafe keys and tolerates partial source", () => {
  const source = `document.invoice.field.foo; document.items[0].field.bar; document.issuer.field.constructor; document?.customer?.field?.good_key?.`;
  expect(keys(detectTemplatePartyFields(pkg(source, true), "react-pdf"))).toEqual(["customer.good_key"]);
  expect(detectTemplatePartyFields(pkg("{{ customer.field."), "gotenberg-html")).toEqual([]);
});
