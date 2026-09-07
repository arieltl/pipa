import type {
  Client,
  Invoice,
  InvoiceItem,
  IssuerSettings,
  NotaFiscalLink,
} from "../db/schema.ts";
import { formatDateBr } from "../domain/dates.ts";
import { formatMoney } from "../domain/money.ts";
import { parsePartySnapshot, fieldValue } from "../domain/party-fields/snapshot.ts";
import type { InvoiceDocumentModel } from "./document-model.ts";

/**
 * Stable PDF view model (spec §17, architecture plan §"PDF Generation"). The
 * PDF layer consumes only this flat, pre-formatted shape — never DB rows or web
 * components — so PDF rendering stays decoupled from storage and UI concerns.
 * All money is pre-formatted to display strings here; the PDF never sees minor
 * units or does arithmetic.
 */
export type InvoicePdfViewModel = {
  issuer: {
    name: string;
    legalName: string | null;
    cnpj: string | null;
    address: string | null;
    email: string | null;
    bankBeneficiary: string | null;
    bankBeneficiaryAddress: string | null;
    bankAccountNumber: string | null;
    bankIban: string | null;
    bankSwiftCode: string | null;
    bankName: string | null;
    bankAddress: string | null;
    bankDetails: string | null;
    pixKey: string | null;
  } | null;
  client: {
    name: string;
    legalName: string | null;
    address: string | null;
    country: string | null;
    email: string | null;
  };
  invoice: {
    number: string;
    date: string;
    currency: string;
    notes: string | null;
  };
  items: Array<{ name: string; value: string }>;
  total: string;
  notaFiscal: {
    number: string | null;
    issueDate: string | null;
    verificationCode: string | null;
    publicUrl: string | null;
  } | null;
};

export type BuildViewModelInput = {
  invoice: Invoice;
  client: Client;
  items: InvoiceItem[];
  total: number;
  issuer: IssuerSettings | null;
  notaFiscal?: NotaFiscalLink | null;
};

/** Map a loaded invoice aggregate into the pre-formatted PDF view model. */
export function buildInvoicePdfViewModel(
  input: BuildViewModelInput,
): InvoicePdfViewModel {
  const { invoice, client, items, total, issuer, notaFiscal } = input;
  const currency = invoice.currency;
  const issuerSnapshot = invoice.issuerSnapshotJson ? parsePartySnapshot(invoice.issuerSnapshotJson) : null;
  const clientSnapshot = invoice.clientSnapshotJson ? parsePartySnapshot(invoice.clientSnapshotJson) : null;
  const sf = (key: string) => issuerSnapshot ? fieldValue(issuerSnapshot.fields, key) : null;
  const cf = (key: string) => clientSnapshot ? fieldValue(clientSnapshot.fields, key) : null;

  return {
    issuer: issuerSnapshot
      ? {
          name: issuerSnapshot.name, legalName: sf("legal_name"), cnpj: sf("br_cnpj") ?? sf("tax_id"),
          address: sf("address"), email: sf("email"), bankBeneficiary: sf("payment_beneficiary"),
          bankBeneficiaryAddress: sf("beneficiary_address"), bankAccountNumber: sf("account_number"),
          bankIban: sf("iban"), bankSwiftCode: sf("swift_bic"), bankName: sf("bank_name"),
          bankAddress: sf("bank_address"), bankDetails: sf("payment_instructions"), pixKey: sf("pix"),
        }
      : issuer
      ? {
          name: issuer.name,
          legalName: issuer.legalName,
          cnpj: issuer.cnpj,
          address: issuer.address,
          email: issuer.email,
          bankBeneficiary: issuer.bankBeneficiary,
          bankBeneficiaryAddress: issuer.bankBeneficiaryAddress,
          bankAccountNumber: issuer.bankAccountNumber,
          bankIban: issuer.bankIban,
          bankSwiftCode: issuer.bankSwiftCode,
          bankName: issuer.bankName,
          bankAddress: issuer.bankAddress,
          bankDetails: issuer.bankDetails,
          pixKey: issuer.pixKey,
        }
      : null,
    client: {
      name: clientSnapshot?.name ?? client.name,
      legalName: clientSnapshot ? cf("legal_name") : client.legalName,
      address: clientSnapshot ? cf("address") : client.address,
      country: clientSnapshot ? cf("country") : client.country,
      email: clientSnapshot ? cf("email") : client.email,
    },
    invoice: {
      number: invoice.number,
      date: formatDateBr(invoice.invoiceDate),
      currency,
      notes: invoice.notes,
    },
    items: items.map((item) => ({
      name: item.name,
      value: formatMoney(item.value, currency),
    })),
    total: formatMoney(total, currency),
    notaFiscal: hasNotaFiscalDetails(notaFiscal)
      ? {
          number: notaFiscal!.nfNumber,
          issueDate: notaFiscal!.issueDate
            ? formatDateBr(notaFiscal!.issueDate)
            : null,
          verificationCode: notaFiscal!.verificationCode,
          publicUrl: notaFiscal!.publicUrl,
        }
      : null,
  };
}

/** True when the link carries metadata worth printing on the PDF. */
function hasNotaFiscalDetails(link: NotaFiscalLink | null | undefined): boolean {
  return Boolean(
    link &&
      (link.nfNumber ||
        link.issueDate ||
        link.verificationCode ||
        link.publicUrl),
  );
}

/** Compatibility adapter for the built-in classic React PDF template. */
export function classicViewModelFromDocument(
  document: InvoiceDocumentModel,
): InvoicePdfViewModel {
  const issuerField = (key: string) => document.issuer.field[key]?.value ?? null;
  const customerField = (key: string) => document.customer.field[key]?.value ?? null;
  const hasIssuer = Boolean(
    document.issuer.name || document.issuer.fields.length,
  );
  return {
    issuer: hasIssuer
      ? {
          name: document.issuer.name,
          legalName: issuerField("legal_name"),
          cnpj: issuerField("br_cnpj") ?? issuerField("tax_id"),
          address: issuerField("address"),
          email: issuerField("email"),
          bankBeneficiary: issuerField("payment_beneficiary"),
          bankBeneficiaryAddress: issuerField("beneficiary_address"),
          bankAccountNumber: issuerField("account_number"),
          bankIban: issuerField("iban"),
          bankSwiftCode: issuerField("swift_bic"),
          bankName: issuerField("bank_name"),
          bankAddress: issuerField("bank_address"),
          bankDetails: issuerField("payment_instructions"),
          pixKey: issuerField("pix"),
        }
      : null,
    client: {
      name: document.customer.name,
      legalName: customerField("legal_name"),
      address: customerField("address"),
      country: customerField("country"),
      email: customerField("email"),
    },
    invoice: {
      number: document.invoice.number,
      date: document.invoice.dateDisplay,
      currency: document.invoice.currency,
      notes: document.invoice.notes,
    },
    items: document.items.map((item) => ({
      name: item.name,
      value: item.valueDisplay,
    })),
    total: document.total.display,
    notaFiscal: document.notaFiscal
      ? {
          number: document.notaFiscal.number,
          issueDate: document.notaFiscal.issueDateDisplay,
          verificationCode: document.notaFiscal.verificationCode,
          publicUrl: document.notaFiscal.publicUrl,
        }
      : null,
  };
}
