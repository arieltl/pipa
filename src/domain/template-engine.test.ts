import { describe, expect, test } from "bun:test";
import {
  renderTemplate,
  templateVariables,
  unknownTemplateVariables,
} from "./template-engine.ts";

const ctx = {
  "client.name": "London Co",
  "invoice.number": "LONDONCO-202606-01",
  "invoice.dateMonthName": "June",
  "invoice.dateYear": "2026",
};

describe("renderTemplate", () => {
  test("substitutes known variables", () => {
    const { output, unknownVars } = renderTemplate(
      "{{client.name}} - services - {{invoice.dateMonthName}} {{invoice.dateYear}}",
      ctx,
    );
    expect(output).toBe("London Co - services - June 2026");
    expect(unknownVars).toEqual([]);
  });

  test("tolerates surrounding whitespace in tokens", () => {
    expect(renderTemplate("{{ client.name }}", ctx).output).toBe("London Co");
  });

  test("leaves unknown variables as visible markers and reports them", () => {
    const { output, unknownVars } = renderTemplate(
      "{{client.name}} / {{client.naem}} / {{bogus}}",
      ctx,
    );
    expect(output).toBe("London Co / {{client.naem}} / {{bogus}}");
    expect(unknownVars).toEqual(["client.naem", "bogus"]);
  });

  test("does not execute or recurse on substituted values", () => {
    const evil = { x: "{{client.name}}" };
    expect(renderTemplate("{{x}}", evil).output).toBe("{{client.name}}");
  });

  test("dedupes repeated unknown variables", () => {
    expect(renderTemplate("{{a}}{{a}}", {}).unknownVars).toEqual(["a"]);
  });
});

describe("templateVariables / unknownTemplateVariables", () => {
  test("lists distinct variables in first-seen order", () => {
    expect(templateVariables("{{b}} {{a}} {{b}}")).toEqual(["b", "a"]);
  });

  test("flags variables outside the allowed set", () => {
    expect(
      unknownTemplateVariables("{{client.name}} {{client.naem}}", [
        "client.name",
        "invoice.number",
      ]),
    ).toEqual(["client.naem"]);
  });
});
