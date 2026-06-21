/** @jsxImportSource react */
import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import type { InvoicePdfViewModel } from "./view-model.ts";

/**
 * React PDF document for a commercial invoice (spec §17). This is a separate
 * rendering layer from the web UI: it uses React PDF primitives and its own
 * stylesheet, and consumes only {@link InvoicePdfViewModel}. Do not import web
 * components here. The whole file renders under React's JSX runtime (pragma
 * above) because the app's global JSX is `hono/jsx`.
 */

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
  issuerName: { fontSize: 16, fontFamily: "Helvetica-Bold" },
  muted: { color: "#6b7280" },
  title: { fontSize: 20, fontFamily: "Helvetica-Bold", textAlign: "right" },
  metaRight: { textAlign: "right" },
  parties: { flexDirection: "row", justifyContent: "space-between", marginBottom: 24 },
  partyBlock: { width: "48%" },
  sectionLabel: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    color: "#9ca3af",
    marginBottom: 4,
    letterSpacing: 0.5,
  },
  partyName: { fontFamily: "Helvetica-Bold" },
  table: { marginTop: 8 },
  tableHead: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#d1d5db",
    paddingBottom: 6,
    marginBottom: 2,
  },
  row: {
    flexDirection: "row",
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
  },
  colName: { flex: 1, paddingRight: 12 },
  colValue: { width: 120, textAlign: "right" },
  headCell: { fontSize: 8, fontFamily: "Helvetica-Bold", color: "#6b7280", textTransform: "uppercase" },
  totalRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 12,
  },
  totalLabel: { fontFamily: "Helvetica-Bold", marginRight: 16, alignSelf: "center" },
  totalValue: {
    fontSize: 14,
    fontFamily: "Helvetica-Bold",
    width: 120,
    textAlign: "right",
  },
  block: { marginTop: 24 },
  blockText: { marginTop: 2 },
  link: { color: "#2563eb" },
});

export function InvoiceDocument({ data }: { data: InvoicePdfViewModel }) {
  const { issuer, client, invoice, items, total, notaFiscal } = data;
  return (
    <Document
      title={`Invoice ${invoice.number}`}
      author={issuer?.name ?? undefined}
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.issuerName}>{issuer?.name ?? "Invoice"}</Text>
            {issuer ? <IssuerLines issuer={issuer} /> : null}
          </View>
          <View>
            <Text style={styles.title}>INVOICE</Text>
            <View style={styles.metaRight}>
              <Text>#{invoice.number}</Text>
              <Text style={styles.muted}>{invoice.date}</Text>
            </View>
          </View>
        </View>

        <View style={styles.parties}>
          <View style={styles.partyBlock}>
            <Text style={styles.sectionLabel}>Bill to</Text>
            <Text style={styles.partyName}>{client.name}</Text>
            {client.legalName ? <Text>{client.legalName}</Text> : null}
            {client.address ? <Text>{client.address}</Text> : null}
            {client.country ? <Text>{client.country}</Text> : null}
            {client.email ? <Text style={styles.muted}>{client.email}</Text> : null}
          </View>
          <View style={styles.partyBlock}>
            <Text style={styles.sectionLabel}>Details</Text>
            <Text>Invoice number: {invoice.number}</Text>
            <Text>Invoice date: {invoice.date}</Text>
            <Text>Currency: {invoice.currency}</Text>
          </View>
        </View>

        <View style={styles.table}>
          <View style={styles.tableHead}>
            <Text style={[styles.colName, styles.headCell]}>Description</Text>
            <Text style={[styles.colValue, styles.headCell]}>Amount</Text>
          </View>
          {items.length === 0 ? (
            <View style={styles.row}>
              <Text style={[styles.colName, styles.muted]}>No items</Text>
              <Text style={styles.colValue}> </Text>
            </View>
          ) : (
            items.map((item, i) => (
              <View style={styles.row} key={i}>
                <Text style={styles.colName}>{item.name}</Text>
                <Text style={styles.colValue}>{item.value}</Text>
              </View>
            ))
          )}
        </View>

        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.totalValue}>{total}</Text>
        </View>

        {issuer && (issuer.bankDetails || issuer.pixKey) ? (
          <View style={styles.block}>
            <Text style={styles.sectionLabel}>Payment details</Text>
            {issuer.bankDetails ? (
              <Text style={styles.blockText}>{issuer.bankDetails}</Text>
            ) : null}
            {issuer.pixKey ? (
              <Text style={styles.blockText}>PIX: {issuer.pixKey}</Text>
            ) : null}
          </View>
        ) : null}

        {invoice.notes ? (
          <View style={styles.block}>
            <Text style={styles.sectionLabel}>Notes</Text>
            <Text style={styles.blockText}>{invoice.notes}</Text>
          </View>
        ) : null}

        {notaFiscal ? (
          <View style={styles.block}>
            <Text style={styles.sectionLabel}>Nota fiscal</Text>
            {notaFiscal.number ? (
              <Text style={styles.blockText}>Number: {notaFiscal.number}</Text>
            ) : null}
            {notaFiscal.issueDate ? (
              <Text style={styles.blockText}>Issued: {notaFiscal.issueDate}</Text>
            ) : null}
            {notaFiscal.verificationCode ? (
              <Text style={styles.blockText}>
                Verification: {notaFiscal.verificationCode}
              </Text>
            ) : null}
            {notaFiscal.publicUrl ? (
              <Text style={[styles.blockText, styles.link]}>
                {notaFiscal.publicUrl}
              </Text>
            ) : null}
          </View>
        ) : null}
      </Page>
    </Document>
  );
}

function IssuerLines({
  issuer,
}: {
  issuer: NonNullable<InvoicePdfViewModel["issuer"]>;
}) {
  return (
    <View style={styles.muted}>
      {issuer.legalName ? <Text>{issuer.legalName}</Text> : null}
      {issuer.cnpj ? <Text>CNPJ: {issuer.cnpj}</Text> : null}
      {issuer.address ? <Text>{issuer.address}</Text> : null}
      {issuer.email ? <Text>{issuer.email}</Text> : null}
    </View>
  );
}
