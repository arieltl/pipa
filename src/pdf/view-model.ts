import type {
  Client,
  Invoice,
  InvoiceItem,
  IssuerSettings,
  NotaFiscalLink,
} from "../db/schema.ts";
import { formatDateBr } from "../domain/dates.ts";
import { formatMoney } from "../domain/money.ts";

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

  return {
    issuer: issuer
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
      name: client.name,
      legalName: client.legalName,
      address: client.address,
      country: client.country,
      email: client.email,
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
