import { describe, expect, test } from "bun:test";
import type { Client, Invoice, InvoiceItem, IssuerSettings } from "../db/schema.ts";
import { serializePartyFields } from "../domain/party-fields/index.ts";
import {
  createPartySnapshot,
  serializePartySnapshot,
} from "../domain/party-fields/snapshot.ts";
import { buildInvoiceDocumentModel } from "./document-model.ts";

function fields() {
  return serializePartyFields([
    {
      key: "legal_name",
      definitionKey: "legal_name",
      label: "Legal name",
      value: "Snapshot Legal Ltd",
      section: "identity",
      visibility: "document",
      position: 0,
    },
    {
      key: "private_note",
      definitionKey: null,
      label: "Private note",
      value: "must not leak",
      section: "other",
      visibility: "internal",
      position: 0,
    },
  ]);
}

describe("buildInvoiceDocumentModel", () => {
  test("uses party snapshots and excludes internal fields", () => {
    const snapshot = serializePartySnapshot(
      createPartySnapshot({ name: "Snapshot Customer", code: "SNAP", partyFieldsJson: fields() }),
    );
    const model = buildInvoiceDocumentModel({
      invoice: {
        number: "INV-1",
        invoiceDate: "2026-06-30",
        currency: "GBP",
        notes: null,
        clientSnapshotJson: snapshot,
        issuerSnapshotJson: serializePartySnapshot({ name: "Issuer snapshot", fields: [] }),
      } as Invoice,
      client: {
        name: "Changed live customer",
        code: "LIVE",
        partyFieldsJson: "[]",
      } as Client,
      issuer: { name: "Changed live issuer", partyFieldsJson: "[]" } as IssuerSettings,
      items: [{ name: "Services", value: 12345 }] as InvoiceItem[],
      total: 12345,
    });

    expect(model.customer.name).toBe("Snapshot Customer");
    expect(model.customer.field.legal_name?.value).toBe("Snapshot Legal Ltd");
    expect(model.customer.field.private_note).toBeUndefined();
    expect(model.customer.sections.other).toEqual([]);
    expect(model.invoice.dateDisplay).toBe("30/06/2026");
    expect(model.total.decimal).toBe("123.45");
  });
});
