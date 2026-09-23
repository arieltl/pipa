import { describe, expect, test } from "bun:test";
import { liquidPreviewFieldSnippet, reactPreviewFieldSnippet } from "../assets/template-field-snippet.ts";

describe("template preview field snippets", () => {
  test("uses bracket access for indexed collection fields", () => {
    expect(liquidPreviewFieldSnippet("items.0.name")).toBe("{{ items[0].name }}");
    expect(reactPreviewFieldSnippet("items.0.name")).toBe("{document.items[0].name}");
  });

  test("guards fields that may be absent from another preview source", () => {
    expect(liquidPreviewFieldSnippet("customer.field.project_reference.value"))
      .toBe('{{ customer.field.project_reference.value | default: "" }}');
    expect(reactPreviewFieldSnippet("customer.field.project_reference.value"))
      .toBe('{document?.customer?.field?.project_reference?.value ?? ""}');
    expect(reactPreviewFieldSnippet("records.0.field.reference.value"))
      .toBe('{document?.records?.[0]?.field?.reference?.value ?? ""}');
  });
});
