/**
 * Editable, standalone source for the built-in Classic template. Keep this in
 * step with invoice-document.tsx while preserving the canonical document model
 * as the public template input.
 */
export const classicEditableReactSource = `import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

const styles = StyleSheet.create({
  page: {
    paddingTop: 40,
    paddingHorizontal: 48,
    paddingBottom: 56,
    fontSize: 10,
    fontFamily: "Helvetica",
    color: "#1f2937",
    lineHeight: 1.4,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 24,
  },
  headerLeft: { width: "62%", paddingRight: 24 },
  headerRight: { width: "32%", alignItems: "flex-end" },
  issuerName: { fontSize: 16, fontFamily: "Helvetica-Bold", lineHeight: 1.18 },
  muted: { color: "#6b7280" },
  title: {
    fontSize: 20,
    fontFamily: "Helvetica-Bold",
    textAlign: "right",
    lineHeight: 1,
  },
  metaRight: { textAlign: "right", marginTop: 5 },
  parties: { marginBottom: 24 },
  partyBlock: { width: "60%" },
  sectionLabel: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    color: "#9ca3af",
    marginBottom: 4,
    letterSpacing: 0.5,
  },
  partyName: { fontFamily: "Helvetica-Bold" },
  table: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: "#d1d5db",
  },
  tableHead: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#d1d5db",
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: "#f9fafb",
  },
  row: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#d1d5db",
    minHeight: 48,
  },
  colName: { flex: 1, paddingRight: 12 },
  colValue: { width: 120, textAlign: "right" },
  headCell: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#6b7280",
    textTransform: "uppercase",
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: "#eff6ff",
  },
  totalLabel: { fontFamily: "Helvetica-Bold", color: "#1e3a8a" },
  totalValue: {
    fontSize: 14,
    fontFamily: "Helvetica-Bold",
    width: 120,
    textAlign: "right",
    color: "#1e3a8a",
  },
  block: { marginTop: 24 },
  blockText: { marginTop: 2 },
  paymentBlock: {
    marginTop: 34,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#d1d5db",
  },
  paymentRow: { flexDirection: "row", marginTop: 4 },
  paymentLabel: { width: 118, color: "#374151" },
  paymentValue: { flex: 1, fontFamily: "Helvetica-Bold" },
  paymentNotes: { marginTop: 6, color: "#374151" },
  link: { color: "#2563eb" },
});

function fieldValue(party, key) {
  return party.field[key]?.value ?? null;
}

function classicViewModel(document) {
  const issuerField = (key) => fieldValue(document.issuer, key);
  const customerField = (key) => fieldValue(document.customer, key);
  const hasIssuer = Boolean(document.issuer.name || document.issuer.fields.length);
  return {
    issuer: hasIssuer ? {
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
    } : null,
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
    notaFiscal: document.notaFiscal ? {
      number: document.notaFiscal.number,
      issueDate: document.notaFiscal.issueDateDisplay,
      verificationCode: document.notaFiscal.verificationCode,
      publicUrl: document.notaFiscal.publicUrl,
    } : null,
  };
}

function hasPaymentDetails(issuer) {
  return Boolean(
    issuer.bankBeneficiary ||
    issuer.bankBeneficiaryAddress ||
    issuer.bankAccountNumber ||
    issuer.bankIban ||
    issuer.bankSwiftCode ||
    issuer.bankName ||
    issuer.bankAddress ||
    issuer.bankDetails ||
    issuer.pixKey
  );
}

function IssuerLines({ issuer }) {
  return <View style={styles.muted}>
    {issuer.legalName ? <Text>{issuer.legalName}</Text> : null}
    {issuer.cnpj ? <Text>CNPJ: {issuer.cnpj}</Text> : null}
    {issuer.address ? <Text>{issuer.address}</Text> : null}
    {issuer.email ? <Text>{issuer.email}</Text> : null}
  </View>;
}

function PaymentDetails({ issuer }) {
  const rows = [
    ["Beneficiary", issuer.bankBeneficiary || issuer.legalName || issuer.name],
    ["Beneficiary address", issuer.bankBeneficiaryAddress || issuer.address],
    ["Account Number (IBAN)", issuer.bankIban || issuer.bankAccountNumber],
    ["SWIFT / BIC", issuer.bankSwiftCode],
    ["Bank name", issuer.bankName],
    ["Bank address", issuer.bankAddress],
    ["PIX", issuer.pixKey],
  ].filter((row) => Boolean(row[1]));

  return <View style={styles.paymentBlock}>
    <Text style={styles.sectionLabel}>Payment info</Text>
    {rows.map(([label, value]) => <View style={styles.paymentRow} key={label}>
      <Text style={styles.paymentLabel}>{label}:</Text>
      <Text style={styles.paymentValue}>{value}</Text>
    </View>)}
    {issuer.bankDetails ? <Text style={styles.paymentNotes}>{issuer.bankDetails}</Text> : null}
  </View>;
}

export default function Template({ document }) {
  const { issuer, client, invoice, items, total, notaFiscal } = classicViewModel(document);
  return <Document title={\`Invoice \${invoice.number}\`} author={issuer?.name ?? undefined}>
    <Page size="A4" style={styles.page}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.issuerName}>{issuer?.name ?? "Invoice"}</Text>
          {issuer ? <IssuerLines issuer={issuer} /> : null}
        </View>
        <View style={styles.headerRight}>
          <Text style={styles.title}>INVOICE</Text>
          <View style={styles.metaRight}>
            <Text>#{invoice.number}</Text>
            <Text style={styles.muted}>{invoice.date}</Text>
          </View>
        </View>
      </View>

      <View style={styles.parties}>
        <View style={styles.partyBlock}>
          <Text style={styles.sectionLabel}>Billed to</Text>
          <Text style={styles.partyName}>{client.name}</Text>
          {client.legalName ? <Text>{client.legalName}</Text> : null}
          {client.address ? <Text>{client.address}</Text> : null}
          {client.country ? <Text>{client.country}</Text> : null}
          {client.email ? <Text style={styles.muted}>{client.email}</Text> : null}
        </View>
      </View>

      <View style={styles.table}>
        <View style={styles.tableHead}>
          <Text style={[styles.colName, styles.headCell]}>Description</Text>
          <Text style={[styles.colValue, styles.headCell]}>Amount</Text>
        </View>
        {items.length === 0 ? <View style={styles.row}>
          <Text style={[styles.colName, styles.muted]}>No items</Text>
          <Text style={styles.colValue}> </Text>
        </View> : items.map((item, index) => <View style={styles.row} key={index}>
          <Text style={styles.colName}>{item.name}</Text>
          <Text style={styles.colValue}>{item.value}</Text>
        </View>)}
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Total ({invoice.currency})</Text>
          <Text style={styles.totalValue}>{total}</Text>
        </View>
      </View>

      {issuer && hasPaymentDetails(issuer) ? <PaymentDetails issuer={issuer} /> : null}

      {invoice.notes ? <View style={styles.block}>
        <Text style={styles.sectionLabel}>Notes</Text>
        <Text style={styles.blockText}>{invoice.notes}</Text>
      </View> : null}

      {notaFiscal ? <View style={styles.block}>
        <Text style={styles.sectionLabel}>Nota fiscal</Text>
        {notaFiscal.number ? <Text style={styles.blockText}>Number: {notaFiscal.number}</Text> : null}
        {notaFiscal.issueDate ? <Text style={styles.blockText}>Issued: {notaFiscal.issueDate}</Text> : null}
        {notaFiscal.verificationCode ? <Text style={styles.blockText}>Verification: {notaFiscal.verificationCode}</Text> : null}
        {notaFiscal.publicUrl ? <Text style={[styles.blockText, styles.link]}>{notaFiscal.publicUrl}</Text> : null}
      </View> : null}
    </Page>
  </Document>;
}
`;
