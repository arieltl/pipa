import { describe, expect, test } from "bun:test";
import { loadIssuerSettings, updateIssuerSettings } from "./settings.service.ts";

const requiredSettings = {
  name: "Ariel",
  defaultCurrency: "USD",
} as const;

describe("issuer settings", () => {
  test("clearing optional payment notes persists as empty", () => {
    updateIssuerSettings({
      ...requiredSettings,
      bankDetails: "Previous payment notes",
      bankIban: "BR1607679404001676134874874C1",
    });

    updateIssuerSettings({
      ...requiredSettings,
      bankDetails: undefined,
      bankIban: undefined,
    });

    const saved = loadIssuerSettings();
    expect(saved?.bankDetails).toBeNull();
    expect(saved?.bankIban).toBeNull();
  });
});
