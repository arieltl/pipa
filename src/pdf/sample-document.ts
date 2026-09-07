import type { InvoiceDocumentModel } from "./document-model.ts";

const emptySections: InvoiceDocumentModel["issuer"]["sections"] = {
  identity: [],
  contact: [],
  address: [],
  payment: [],
  other: [],
};

export const sampleInvoiceDocument: InvoiceDocumentModel = {
  issuer: {
    name: "Example Studio",
    fields: [],
    field: {},
    sections: { ...emptySections },
  },
  customer: {
    name: "Example Customer",
    code: "EXAMPLE",
    fields: [],
    field: {},
    sections: { ...emptySections },
  },
  invoice: {
    number: "EXAMPLE-202609-01",
    dateIso: "2026-09-01",
    dateDisplay: "01/09/2026",
    dateYear: "2026",
    dateMonth: "09",
    currency: "USD",
    notes: "Thank you.",
  },
  items: [
    {
      name: "Software development services",
      valueMinor: 100000,
      valueDisplay: "$1,000.00",
    },
  ],
  total: { minor: 100000, decimal: "1000.00", display: "$1,000.00" },
  records: [],
  notaFiscal: null,
};
