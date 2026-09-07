import { describe, expect, test } from "bun:test";
import { loadIssuerSettings, updateIssuerSettings } from "./settings.service.ts";
import { parsePartyFields } from "../../domain/party-fields/index.ts";

const requiredSettings = {
  name: "Ariel",
  defaultCurrency: "USD",
} as const;

describe("issuer settings", () => {
  test("clearing generalized payment fields persists as empty", () => {
    updateIssuerSettings({
      ...requiredSettings,
      partyFields: [
        { key: "iban", definitionKey: "iban", label: "IBAN", value: "BR1607679404001676134874874C1", section: "payment", visibility: "document", position: 0 },
      ],
    });

    updateIssuerSettings({
      ...requiredSettings,
      partyFields: [],
    });

    const saved = loadIssuerSettings();
    expect(parsePartyFields(saved!.partyFieldsJson)).toEqual([]);
  });
});
