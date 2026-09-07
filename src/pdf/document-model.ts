import type {
  Client,
  Invoice,
  InvoiceItem,
  IssuerSettings,
  NotaFiscalLink,
} from "../db/schema.ts";
import { formatDateBr } from "../domain/dates.ts";
import { formatMoney, minorToDecimalString } from "../domain/money.ts";
import {
  PARTY_FIELD_SECTIONS,
  type PartyFieldSection,
} from "../domain/party-fields/index.ts";
import {
  createPartySnapshot,
  parsePartySnapshot,
  type InvoicePartySnapshot,
} from "../domain/party-fields/snapshot.ts";

export type DocumentField = {
  key: string;
  label: string;
  value: string;
};

export type DocumentParty = {
  name: string;
  code?: string;
  fields: DocumentField[];
  field: Record<string, DocumentField>;
  sections: Record<PartyFieldSection, DocumentField[]>;
};

export type InvoiceDocumentModel = {
  issuer: DocumentParty;
  customer: DocumentParty;
  invoice: {
    number: string;
    dateIso: string;
    dateDisplay: string;
    dateYear: string;
    dateMonth: string;
    currency: string;
    notes: string | null;
  };
  items: Array<{
    name: string;
    valueMinor: number;
    valueDisplay: string;
  }>;
  total: { minor: number; decimal: string; display: string };
  records: Array<{
    typeKey: string;
    typeName: string;
    purpose: string;
    field: Record<string, { label: string; value: string | boolean }>;
  }>;
  /** @deprecated Compatibility alias while legacy NFS-e templates migrate. */
  notaFiscal: {
    number: string | null;
    issueDateIso: string | null;
    issueDateDisplay: string | null;
    verificationCode: string | null;
    publicUrl: string | null;
  } | null;
};

export type BuildDocumentModelInput = {
  invoice: Invoice;
  client: Client;
  issuer: IssuerSettings | null;
  items: InvoiceItem[];
  total: number;
  notaFiscal?: NotaFiscalLink | null;
  records?: Array<{ recordTypeKey: string; recordTypeName: string; purpose: string; definitions: { fields: Array<{ key: string; label: string }> }; values: Record<string, string | boolean> }>;
};

function partyFromSnapshot(snapshot: InvoicePartySnapshot): DocumentParty {
  const fields = snapshot.fields.map(({ key, label, value }) => ({
    key,
    label,
    value,
  }));
  const sections = Object.fromEntries(
    PARTY_FIELD_SECTIONS.map((section) => [
      section,
      snapshot.fields
        .filter((field) => field.section === section)
        .map(({ key, label, value }) => ({ key, label, value })),
    ]),
  ) as Record<PartyFieldSection, DocumentField[]>;

  return {
    name: snapshot.name,
    ...(snapshot.code ? { code: snapshot.code } : {}),
    fields,
    field: Object.fromEntries(fields.map((field) => [field.key, field])),
    sections,
  };
}

function emptyParty(name = "Invoice"): InvoicePartySnapshot {
  return { name, fields: [] };
}

/**
 * Build the stable renderer-neutral contract used by Liquid text/PDF templates.
 * Invoice snapshots are authoritative. Live party rows are only a compatibility
 * fallback for invoices created before snapshot columns existed.
 */
export function buildInvoiceDocumentModel(
  input: BuildDocumentModelInput,
): InvoiceDocumentModel {
  const { invoice, client, issuer, items, total, notaFiscal, records = [] } = input;
  const issuerSnapshot = invoice.issuerSnapshotJson
    ? parsePartySnapshot(invoice.issuerSnapshotJson)
    : issuer
      ? createPartySnapshot(issuer)
      : emptyParty();
  const customerSnapshot = invoice.clientSnapshotJson
    ? parsePartySnapshot(invoice.clientSnapshotJson)
    : createPartySnapshot(client);
  const [dateYear = "", dateMonth = ""] = invoice.invoiceDate.split("-");
  const nfseRecord = records.find((record) => record.purpose === "nfse");
  const nfseValue = (key: string) => {
    const value = nfseRecord?.values[key];
    return typeof value === "string" && value !== "" ? value : null;
  };
  const nfseIssueDate = notaFiscal?.issueDate ?? nfseValue("issue_date");

  return {
    issuer: partyFromSnapshot(issuerSnapshot),
    customer: partyFromSnapshot(customerSnapshot),
    invoice: {
      number: invoice.number,
      dateIso: invoice.invoiceDate,
      dateDisplay: formatDateBr(invoice.invoiceDate),
      dateYear,
      dateMonth,
      currency: invoice.currency,
      notes: invoice.notes,
    },
    items: items.map((item) => ({
      name: item.name,
      valueMinor: item.value,
      valueDisplay: formatMoney(item.value, invoice.currency),
    })),
    total: {
      minor: total,
      decimal: minorToDecimalString(total, invoice.currency),
      display: formatMoney(total, invoice.currency),
    },
    records: records.map((record) => ({
      typeKey: record.recordTypeKey,
      typeName: record.recordTypeName,
      purpose: record.purpose,
      field: Object.fromEntries(record.definitions.fields.map((definition) => [definition.key, { label: definition.label, value: record.values[definition.key] ?? "" }])),
    })),
    notaFiscal: notaFiscal || nfseRecord
      ? {
          number: notaFiscal?.nfNumber ?? nfseValue("number"),
          issueDateIso: nfseIssueDate,
          issueDateDisplay: nfseIssueDate
            ? formatDateBr(nfseIssueDate)
            : null,
          verificationCode: notaFiscal?.verificationCode ?? nfseValue("verification_code"),
          publicUrl: notaFiscal?.publicUrl ?? nfseValue("public_url"),
        }
      : null,
  };
}
