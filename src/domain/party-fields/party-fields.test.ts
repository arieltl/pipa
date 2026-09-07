import { describe, expect, test } from "bun:test";
import { applyFieldSet, documentFields, parsePartyFields, serializePartyFields, validatePartyFieldValues, type PartyField } from "./index.ts";
import { createPartySnapshot, parsePartySnapshot, serializePartySnapshot } from "./snapshot.ts";

const field = (overrides: Partial<PartyField> = {}): PartyField => ({ key: "legal_name", definitionKey: "legal_name", label: "Legal name", value: "Acme Ltd", section: "identity", visibility: "document", position: 0, ...overrides });

describe("party fields", () => {
  test("round-trips order and stored labels", () => {
    const fields = [field({ label: "Registered entity" }), field({ key: "email", definitionKey: "email", label: "Accounts email", value: "pay@acme.test", section: "contact", position: 0 })];
    expect(parsePartyFields(serializePartyFields(fields))).toEqual(fields);
  });
  test("rejects duplicate keys case-insensitively and unsafe keys", () => {
    expect(() => serializePartyFields([field(), field({ key: "legal_name" })])).toThrow("Duplicate");
    expect(() => serializePartyFields([field({ key: "../bad" })])).toThrow();
  });
  test("field sets are idempotent and never overwrite values", () => {
    const once = applyFieldSet([field()], "generic_business");
    const twice = applyFieldSet(once, "generic_business");
    expect(twice).toEqual(once);
    expect(twice.find((f) => f.key === "legal_name")?.value).toBe("Acme Ltd");
  });
  test("snapshots omit empty and internal fields", () => {
    const fields = [field(), field({ key: "private_note", definitionKey: null, label: "Private", value: "secret", visibility: "internal" }), field({ key: "phone", definitionKey: "phone", label: "Phone", value: "" })];
    const snapshot = createPartySnapshot({ name: "Acme", code: "ACME", partyFieldsJson: serializePartyFields(fields) });
    expect(snapshot.fields.map((f) => f.key)).toEqual(["legal_name"]);
    expect(parsePartySnapshot(serializePartySnapshot(snapshot))).toEqual(snapshot);
    expect(documentFields(fields)).toHaveLength(1);
  });
  test("strict values reject and advisory formats warn", () => {
    expect(() => validatePartyFieldValues([field({ key: "email", definitionKey: "email", label: "Email", value: "bad", section: "contact" })])).toThrow("valid email");
    expect(validatePartyFieldValues([field({ key: "iban", definitionKey: "iban", label: "IBAN", value: "bad", section: "payment" })])).toHaveLength(1);
  });
});
