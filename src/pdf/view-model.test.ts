import { describe, expect, test } from "bun:test";
import type {
  Client,
  Invoice,
  InvoiceItem,
  IssuerSettings,
  NotaFiscalLink,
} from "../db/schema.ts";
import { buildInvoicePdfViewModel } from "./view-model.ts";

const client = {
  id: 1,
  name: "London Co",
  legalName: "London Co Ltd",
  code: "LONDONCO",
  address: "1 City Rd",
  country: "United Kingdom",
  email: "ap@londonco.example",
} as Client;

const invoice = {
  id: 1,
  number: "LONDONCO-202606-01",
  invoiceDate: "2026-06-30",
  currency: "GBP",
  notes: "Thanks!",
} as Invoice;

const items = [
  { name: "Dev services", value: 400000 },
  { name: "Travel", value: 12000 },
] as InvoiceItem[];

const issuer = {
  name: "Ariel",
  legalName: "Ariel ME",
  cnpj: "00.000.000/0001-00",
  bankDetails: "Bank xyz",
  pixKey: "pix@x",
} as IssuerSettings;

describe("buildInvoicePdfViewModel", () => {
  test("formats money and dates and maps items", () => {
    const vm = buildInvoicePdfViewModel({
      invoice,
      client,
      items,
      total: 412000,
      issuer,
    });

    expect(vm.invoice.date).toBe("30/06/2026");
    expect(vm.invoice.currency).toBe("GBP");
    expect(vm.items).toEqual([
      { name: "Dev services", value: "£4,000.00" },
      { name: "Travel", value: "£120.00" },
    ]);
    expect(vm.total).toBe("£4,120.00");
    expect(vm.issuer?.cnpj).toBe("00.000.000/0001-00");
  });

  test("omits nota fiscal when the link has no usable details", () => {
    const vm = buildInvoicePdfViewModel({
      invoice,
      client,
      items,
      total: 412000,
      issuer,
      notaFiscal: { invoiceId: 1, nfNumber: null } as NotaFiscalLink,
    });
    expect(vm.notaFiscal).toBeNull();
  });

  test("includes and formats nota fiscal metadata when present", () => {
    const vm = buildInvoicePdfViewModel({
      invoice,
      client,
      items,
      total: 412000,
      issuer,
      notaFiscal: {
        invoiceId: 1,
        nfNumber: "2026/123",
        issueDate: "2026-07-01",
        verificationCode: "ABC",
        publicUrl: "https://nfse.example/123",
      } as NotaFiscalLink,
    });
    expect(vm.notaFiscal).toEqual({
      number: "2026/123",
      issueDate: "01/07/2026",
      verificationCode: "ABC",
      publicUrl: "https://nfse.example/123",
    });
  });

  test("tolerates a missing issuer", () => {
    const vm = buildInvoicePdfViewModel({
      invoice,
      client,
      items,
      total: 412000,
      issuer: null,
    });
    expect(vm.issuer).toBeNull();
  });
});
