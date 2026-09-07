import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "../../db/client.ts";
import { clientInvoiceRecordTypes, clients, files, invoiceRecordAttachments, invoiceRecords, invoices } from "../../db/schema.ts";
import { nowIso } from "../../domain/dates.ts";
import { getInvoiceDetail } from "../invoices/invoices.service.ts";
import { createRecordType } from "./invoice-records.service.ts";
import { attachToInvoiceRecord, createInvoiceRecord, listInvoiceRecords, MAX_RECORD_ATTACHMENT_BYTES, updateInvoiceRecord } from "./invoice-records.instances.ts";

beforeEach(() => {
  db.delete(invoiceRecordAttachments).run(); db.delete(invoiceRecords).run(); db.delete(invoices).run(); db.delete(clientInvoiceRecordTypes).run(); db.delete(clients).run(); db.delete(files).run();
});

describe("generalized invoice records", () => {
  test("snapshots definitions, validates values, and stores attachments append-only", async () => {
    const now = nowIso();
    const client = db.insert(clients).values({ name: "Client", code: "RECORD", defaultCurrency: "GBP", createdAt: now, updatedAt: now }).returning().get();
    const invoice = db.insert(invoices).values({ clientId: client.id, number: "RECORD-1", invoiceDate: "2026-09-06", currency: "GBP", status: "issued", createdAt: now, updatedAt: now }).returning().get();
    const type = createRecordType(client.id, { name: "Purchase order", key: "purchase_order", purpose: "custom", allowMultiple: false, fieldDefinitionsJson: [{ key: "number", label: "PO number", kind: "text", required: true, choices: [] }], attachmentDefinitionsJson: [{ key: "document", label: "Document", acceptedTypes: ["application/pdf"], maximumCount: 1, required: false }] });
    const detail = getInvoiceDetail(invoice.id)!;
    const record = createInvoiceRecord(detail, type.id, {});
    expect(() => updateInvoiceRecord(detail, record.id, {})).toThrow("PO number is required");
    updateInvoiceRecord(detail, record.id, { number: "PO-42" });
    await attachToInvoiceRecord(detail, record.id, "document", new File(["first"], "po.pdf", { type: "application/pdf" }));
    await attachToInvoiceRecord(detail, record.id, "document", new File(["second"], "po-new.pdf", { type: "application/pdf" }));
    const saved = listInvoiceRecords(invoice.id)[0]!;
    expect(saved.values.number).toBe("PO-42");
    expect(saved.definitions.fields[0]?.label).toBe("PO number");
    expect(saved.attachments).toHaveLength(2);
    expect(saved.attachments[0]?.file.supersededByFileId).toBe(saved.attachments[1]?.file.id);
  });

  test("enforces configured select, URL, date, number, and upload constraints", async () => {
    const now = nowIso();
    const client = db.insert(clients).values({ name: "Client", code: "VALIDATE", defaultCurrency: "GBP", createdAt: now, updatedAt: now }).returning().get();
    const invoice = db.insert(invoices).values({ clientId: client.id, number: "VALIDATE-1", invoiceDate: "2026-09-06", currency: "GBP", status: "issued", createdAt: now, updatedAt: now }).returning().get();
    const type = createRecordType(client.id, {
      name: "Evidence", key: "evidence", purpose: "custom", allowMultiple: false,
      fieldDefinitionsJson: [
        { key: "state", label: "State", kind: "select", required: true, choices: ["approved", "rejected"] },
        { key: "amount", label: "Amount", kind: "number", required: false, choices: [] },
        { key: "date", label: "Date", kind: "date", required: false, choices: [] },
        { key: "url", label: "Public URL", kind: "url", required: false, choices: [] },
      ],
      attachmentDefinitionsJson: [{ key: "proof", label: "Proof", acceptedTypes: [], maximumCount: 1, required: false }],
    });
    const detail = getInvoiceDetail(invoice.id)!;
    const record = createInvoiceRecord(detail, type.id, {});
    expect(() => updateInvoiceRecord(detail, record.id, { state: "unknown" })).toThrow("configured choices");
    expect(() => updateInvoiceRecord(detail, record.id, { state: "approved", amount: "lots" })).toThrow("must be a number");
    expect(() => updateInvoiceRecord(detail, record.id, { state: "approved", amount: "2", date: "2026-02-30" })).toThrow("must be a valid date");
    expect(() => updateInvoiceRecord(detail, record.id, { state: "approved", amount: "2", date: "2026-02-28", url: "javascript:alert(1)" })).toThrow("HTTP(S)");
    await expect(attachToInvoiceRecord(detail, record.id, "proof", new File([new Uint8Array(MAX_RECORD_ATTACHMENT_BYTES + 1)], "large.bin"))).rejects.toThrow("10 MiB");
  });
});
