import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "../../db/client.ts";
import {
  clients,
  clientTextGenerators,
  invoiceGeneratedTexts,
  invoices,
} from "../../db/schema.ts";
import { nowIso } from "../../domain/dates.ts";
import {
  createTextGenerator,
  getSavedGeneratedText,
  saveGeneratedText,
  TextGeneratorKeyImmutableError,
  TextGeneratorPurposeTakenError,
  updateTextGenerator,
  LiquidSourceError,
} from "./text-generators.service.ts";

beforeEach(() => {
  db.delete(invoiceGeneratedTexts).run();
  db.delete(clientTextGenerators).run();
  db.delete(invoices).run();
  db.delete(clients).run();
});

function clientAndInvoice() {
  const now = nowIso();
  const client = db
    .insert(clients)
    .values({
      name: "Generator client",
      code: `GEN${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
      defaultCurrency: "GBP",
      partyFieldsJson: "[]",
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  const invoice = db
    .insert(invoices)
    .values({
      clientId: client.id,
      number: `GEN-${Date.now()}-${Math.random()}`,
      invoiceDate: "2026-06-30",
      currency: "GBP",
      status: "draft",
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  return { client, invoice };
}

describe("client text generators", () => {
  test("allows only one active NFS-e purpose and keeps keys immutable", () => {
    const { client } = clientAndInvoice();
    const generator = createTextGenerator(client.id, {
      name: "NFS-e",
      key: "nfse_description",
      purpose: "nfse-description",
      source: "{{ invoice.number }}",
    });
    expect(() =>
      createTextGenerator(client.id, {
        name: "Another NFS-e",
        key: "other_nfse",
        purpose: "nfse-description",
        source: "text",
      }),
    ).toThrow(TextGeneratorPurposeTakenError);
    expect(() =>
      updateTextGenerator(client.id, generator.id, {
        name: generator.name,
        key: "changed_key",
        purpose: "nfse-description",
        source: generator.source,
      }),
    ).toThrow(TextGeneratorKeyImmutableError);
  });

  test("saved output retains the exact source snapshot supplied by generation", () => {
    const { client, invoice } = clientAndInvoice();
    const original = createTextGenerator(client.id, {
      name: "Email",
      key: "email_body",
      purpose: "custom",
      source: "Original {{ invoice.number }}",
    });
    saveGeneratedText(invoice.id, original, "Edited output", original.source);
    updateTextGenerator(client.id, original.id, {
      name: original.name,
      key: original.key,
      purpose: "custom",
      source: "Changed {{ invoice.number }}",
    });

    expect(getSavedGeneratedText(invoice.id, original.key)).toMatchObject({
      content: "Edited output",
      sourceSnapshot: "Original {{ invoice.number }}",
      generatorName: "Email",
    });
  });

  test("rejects unknown paths during sample validation", () => {
    const { client } = clientAndInvoice();
    expect(() =>
      createTextGenerator(client.id, {
        name: "Typo",
        key: "typo",
        purpose: "custom",
        source: "{{ customer.naem }}",
      }),
    ).toThrow(LiquidSourceError);
  });
});
