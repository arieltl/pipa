import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "../../db/client.ts";
import {
  clients,
  invoiceItems,
  invoiceSequences,
  invoices,
} from "../../db/schema.ts";
import {
  createClient,
  getDefaultClient,
  setDefaultClient,
  updateClient,
} from "./clients.service.ts";
import { emptyClientFormValues } from "./clients.view.ts";
import { clientFormSchema } from "./clients.schema.ts";
import { parsePartyFields, type PartyField } from "../../domain/party-fields/index.ts";

/** Build a validated client input from form-value overrides. */
function input(overrides: Record<string, unknown> = {}) {
  const parsed = clientFormSchema.safeParse({
    ...emptyClientFormValues(),
    name: "Acme",
    code: `C${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    ...overrides,
  });
  if (!parsed.success) throw new Error("invalid test input");
  return parsed.data;
}

beforeEach(() => {
  // Clear FK-dependent rows before clients (other suites share this DB file).
  db.delete(invoiceItems).run();
  db.delete(invoices).run();
  db.delete(invoiceSequences).run();
  db.delete(clients).run();
});

describe("default client", () => {
  test("pinning a client clears the flag on every other client", () => {
    const a = createClient(input({ isDefault: "on" }));
    expect(getDefaultClient()?.id).toBe(a.id);

    const b = createClient(input({ isDefault: "on" }));
    expect(getDefaultClient()?.id).toBe(b.id);

    // The first client is no longer the default.
    expect(db.select().from(clients).all().filter((c) => c.isDefault)).toHaveLength(1);
  });

  test("setDefaultClient moves the pin", () => {
    const a = createClient(input());
    const b = createClient(input());
    setDefaultClient(a.id);
    expect(getDefaultClient()?.id).toBe(a.id);
    setDefaultClient(b.id);
    expect(getDefaultClient()?.id).toBe(b.id);
  });

  test("updating a client to default clears others", () => {
    const a = createClient(input({ isDefault: "on" }));
    const b = createClient(input());
    updateClient(b.id, input({ code: b.code, isDefault: "on" }));
    expect(getDefaultClient()?.id).toBe(b.id);
    expect(db.select().from(clients).all().filter((c) => c.isDefault)).toHaveLength(1);
    expect(a.id).not.toBe(b.id);
  });
});

describe("generalized party fields", () => {
  test("persists custom fields without writing through the legacy fixed schema", () => {
    const partyFields: PartyField[] = [{ key: "purchase_order_contact", definitionKey: null, label: "PO contact", value: "Morgan", section: "other", visibility: "document", position: 0 }];
    const client = createClient(input({ partyFields }));
    expect(parsePartyFields(client.partyFieldsJson)).toEqual(partyFields);
    expect(client.legalName).toBeNull();
  });

  test("requires acknowledgement for advisory format warnings", () => {
    const partyFields = [{ key: "iban", definitionKey: "iban", label: "IBAN", value: "not-an-iban", section: "payment", visibility: "document", position: 0 }];
    expect(clientFormSchema.safeParse({ ...emptyClientFormValues(), name: "Acme", code: "ACME", partyFields }).success).toBe(false);
    expect(clientFormSchema.safeParse({ ...emptyClientFormValues(), name: "Acme", code: "ACME", partyFields, acknowledgePartyWarnings: "on" }).success).toBe(true);
  });
});
