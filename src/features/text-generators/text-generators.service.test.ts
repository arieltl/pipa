import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "../../db/client.ts";
import {
  clients,
  clientTextGenerators,
  invoiceGeneratedTexts,
  invoices,
} from "../../db/schema.ts";
import { getInvoiceDetail, workspaceGeneratedTexts } from "../invoices/invoices.service.ts";
import { nowIso } from "../../domain/dates.ts";
import {
  createTextGenerator,
  getSavedGeneratedText,
  saveGeneratedText,
  TextGeneratorKeyImmutableError,
  TextGeneratorPurposeTakenError,
  updateTextGenerator,
  LiquidSourceError,
  listClientTextGenerators,
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
  test("flags incompatible migrated templates without altering their original source", () => {
    const { client } = clientAndInvoice();
    const source = "Original {{ legacy.unsupported }}";
    const now = nowIso();
    db.insert(clientTextGenerators).values({ clientId: client.id, key: "legacy", name: "Legacy", purpose: "custom", source, createdAt: now, updatedAt: now }).run();
    const generator = listClientTextGenerators(client.id)[0]!;
    expect(generator.source).toBe(source);
    expect(generator.validationWarning).toContain("needs review");
    expect(db.select().from(clientTextGenerators).get()?.source).toBe(source);
  });
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

test("workspace shows unsaved generators, preserves saved blanks and edits, and never writes on read", () => {
  const { client, invoice } = clientAndInvoice();
  const nfse = createTextGenerator(client.id, { key: "nfse_description", name: "NFS-e", purpose: "nfse-description", source: "Service {{ invoice.number }}" });
  const email = createTextGenerator(client.id, { key: "email", name: "Email", purpose: "custom", source: "Hello {{ customer.name }}" });
  const read = () => workspaceGeneratedTexts(getInvoiceDetail(invoice.id)!);
  expect(read().map(text => text.content)).toEqual([`Service ${invoice.number}`, "Hello Generator client"]);
  expect(read().every(text => !text.saved)).toBe(true);
  expect(db.select().from(invoiceGeneratedTexts).all()).toHaveLength(0);
  expect(getInvoiceDetail(invoice.id)!.invoice.workspaceRevision).toBe(invoice.workspaceRevision);
  saveGeneratedText(invoice.id, nfse, "");
  saveGeneratedText(invoice.id, email, "Manually reviewed");
  expect(Object.fromEntries(read().map(text => [text.generatorKey, text.content]))).toEqual({ nfse_description: "", email: "Manually reviewed" });
  expect(read().every(text => text.saved)).toBe(true);
});
