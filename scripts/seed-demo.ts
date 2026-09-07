/**
 * Create the synthetic data used by documentation screenshots.
 *
 * This script deliberately ignores DB_PATH, FILES_DIR and TMP_DIR inherited
 * from the shell. It only ever writes below DEMO_DATA_DIR (default:
 * ./data/docs-demo), and never deletes or resets a database.
 *
 * Run: bun run scripts/seed-demo.ts
 * Custom location: DEMO_DATA_DIR=./data/my-docs-demo bun run scripts/seed-demo.ts
 */
import { existsSync, lstatSync, mkdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { Database } from "bun:sqlite";

const workspace = resolve(import.meta.dir, "..");
const requestedDir = process.env.DEMO_DATA_DIR ?? "./data/docs-demo";
const demoDataDir = resolve(workspace, requestedDir);
const normalDataDir = resolve(workspace, "data");

function isWithin(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel !== "" && !rel.startsWith("..") && !rel.startsWith("/");
}

function assertNoSymlinkInDemoPath(candidate: string): void {
  let current = candidate;
  while (current !== workspace) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new Error(`Refusing symlinked demo storage path: ${current}`);
    }
    const parent = dirname(current);
    if (parent === current) throw new Error(`Refusing unsafe demo storage path: ${candidate}`);
    current = parent;
  }
}

// A typo such as DEMO_DATA_DIR=./data must never turn this into a production
// seed command. Custom roots must still be descendants of this checkout.
if (!isWithin(workspace, demoDataDir) || demoDataDir === normalDataDir || demoDataDir === workspace) {
  throw new Error(`Refusing unsafe DEMO_DATA_DIR: ${demoDataDir}`);
}

const demoDbPath = join(demoDataDir, "app.db");
const demoFilesDir = join(demoDataDir, "files");
const demoTmpDir = join(demoDataDir, "tmp");

assertNoSymlinkInDemoPath(demoDataDir);
assertNoSymlinkInDemoPath(demoDbPath);
assertNoSymlinkInDemoPath(demoFilesDir);
assertNoSymlinkInDemoPath(demoTmpDir);

// Set every storage variable before importing any application module. The DB
// client opens SQLite at import time, so imports below must remain dynamic.
process.env.DATA_DIR = demoDataDir;
process.env.DB_PATH = demoDbPath;
process.env.FILES_DIR = demoFilesDir;
process.env.TMP_DIR = demoTmpDir;

function alreadySeeded(): boolean {
  if (!existsSync(demoDbPath)) return false;
  const sqlite = new Database(demoDbPath, { readonly: true });
  try {
    const marker = sqlite
      .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'demo_seed_meta'")
      .get() as { name?: string } | null;
    if (marker?.name) {
      const row = sqlite.query("SELECT value FROM demo_seed_meta WHERE key = 'fixture'").get() as { value?: string } | null;
      if (row?.value === "docs-demo-v1") return true;
    }
    throw new Error(`Refusing existing unmarked demo database: ${demoDbPath}`);
  } finally {
    sqlite.close();
  }
}

if (alreadySeeded()) {
  console.log(JSON.stringify({ status: "already_seeded", dataDir: demoDataDir, dbPath: demoDbPath }));
  process.exit(0);
}

mkdirSync(dirname(demoDbPath), { recursive: true });

const [{ ensureDataDirs }, { runMigrations }, settings, clients, invoices, textGenerators, recordTypes, recordInstances, { absolutePath }, { listProfiles }, { mergePartyFieldValues }, { db }] = await Promise.all([
  import("../src/config/paths.ts"),
  import("../src/db/migrate.ts"),
  import("../src/features/settings/settings.service.ts"),
  import("../src/features/clients/clients.service.ts"),
  import("../src/features/invoices/invoices.service.ts"),
  import("../src/features/text-generators/text-generators.service.ts"),
  import("../src/features/invoice-records/invoice-records.service.ts"),
  import("../src/features/invoice-records/invoice-records.instances.ts"),
  import("../src/features/files/files.service.ts"),
  import("../src/features/numbering/numbering.repository.ts"),
  import("../src/domain/party-fields/index.ts"),
  import("../src/db/client.ts"),
]);

ensureDataDirs();
runMigrations();

const issuerFields = mergePartyFieldValues("[]", {
  legal_name: "Aurora Stack Tecnologia Ltda. (demo)",
  email: "finance@aurora-stack.example",
  website: "https://aurora-stack.example",
  address: "Rua das Palmeiras, 1200\nSão Paulo — SP, 01400-000",
  country: "Brazil",
  payment_beneficiary: "Aurora Stack Tecnologia Ltda. (demo)",
  bank_name: "Fictional Documentation Bank",
  account_number: "DEMO ACCOUNT — NOT FOR PAYMENT",
  swift_bic: "DEMOUS33",
  payment_instructions: "Demo only — no payment account or transfer instructions are valid.",
});
settings.updateIssuerSettings({
  name: "Aurora Stack — Demo Studio",
  defaultCurrency: "USD",
  defaultPdfFilenameTemplate: "{{invoice.number}}-{{client.code}}.pdf",
  partyFields: JSON.parse(issuerFields),
  acknowledgePartyWarnings: true,
});

const profiles = listProfiles();
const monthly = profiles.find((profile) => profile.name === "Monthly per client");
if (!monthly) throw new Error("Expected default Monthly per client numbering profile");

function party(values: Record<string, string>) {
  return JSON.parse(mergePartyFieldValues("[]", values));
}

const northstar = clients.createClient({
  name: "Northstar Analytics — DEMO",
  code: "NSTAR",
  defaultCurrency: "USD",
  defaultFixedMonthlyValue: "6400.00",
  defaultFixedMonthlyItemNameTemplate: "Platform engineering retainer — {{invoice.date}}",
  defaultPdfFilenameTemplate: "{{invoice.number}}-northstar-demo.pdf",
  numberingProfileId: monthly.id,
  isDefault: true,
  partyFields: party({ legal_name: "Northstar Analytics Inc. (demo)", email: "ap@northstar.example", website: "https://northstar.example", address: "77 Orbit Avenue\nWilmington, DE 19801", country: "United States" }),
});
const briar = clients.createClient({
  name: "Briar & Finch Ltd. — DEMO",
  code: "BRIAR",
  defaultCurrency: "GBP",
  defaultFixedMonthlyValue: "4850.00",
  defaultFixedMonthlyItemNameTemplate: "Product development services — {{invoice.date}}",
  defaultPdfFilenameTemplate: "{{invoice.number}}-briar-demo.pdf",
  numberingProfileId: monthly.id,
  isDefault: false,
  partyFields: party({ legal_name: "Briar & Finch Ltd. (demo)", email: "accounts@briarfinch.example", website: "https://briarfinch.example", address: "18 Paper Street\nLondon EC1A 1BB", country: "United Kingdom" }),
});
const lumen = clients.createClient({
  name: "Lumen Atelier SAS — DEMO",
  code: "LUMEN",
  defaultCurrency: "EUR",
  defaultFixedMonthlyValue: "5700.00",
  defaultFixedMonthlyItemNameTemplate: "Software architecture and delivery — {{invoice.date}}",
  defaultPdfFilenameTemplate: "{{invoice.number}}-lumen-demo.pdf",
  numberingProfileId: monthly.id,
  isDefault: false,
  partyFields: party({ legal_name: "Lumen Atelier SAS (demo)", email: "finance@lumen-atelier.example", website: "https://lumen-atelier.example", address: "24 rue des Pixels\n75011 Paris", country: "France" }),
});
const cedar = clients.createClient({
  name: "Cedar Trail Systems — DEMO",
  code: "CEDAR",
  defaultCurrency: "USD",
  defaultFixedMonthlyValue: "3200.00",
  defaultFixedMonthlyItemNameTemplate: "Maintenance and reliability support — {{invoice.date}}",
  defaultPdfFilenameTemplate: "{{invoice.number}}-cedar-demo.pdf",
  numberingProfileId: monthly.id,
  isDefault: false,
  partyFields: party({ legal_name: "Cedar Trail Systems LLC (demo)", email: "billing@cedartrail.example", website: "https://cedartrail.example", address: "401 Juniper Lane\nPortland, OR 97205", country: "United States" }),
});

textGenerators.createTextGenerator(northstar.id, { key: "nfse_description", name: "NFS-e service description", purpose: "nfse-description", source: "Software development and technical consulting services provided remotely to {{ customer.name }} (invoice {{ invoice.number }}), covering {{ invoice.dateDisplay }}. Documentation fixture; no commercial validity." });
textGenerators.createTextGenerator(northstar.id, { key: "client_email", name: "Client email", purpose: "custom", source: "Hello {{ customer.name }},\n\nThank you for partnering with Aurora Stack (demo). Please use {{ invoice.number }} as the reference for this invoice.\n\nKind regards,\nAurora Stack (demo)" });

const nfseType = recordTypes.createRecordType(northstar.id, {
  key: "nfse", name: "NFS-e", purpose: "nfse", allowMultiple: false,
  fieldDefinitionsJson: [
    { key: "number", label: "NFS-e number", kind: "text", required: false, choices: [] },
    { key: "issue_date", label: "Issue date", kind: "date", required: false, choices: [] },
    { key: "verification_code", label: "Verification code", kind: "text", required: false, choices: [] },
    { key: "public_url", label: "Public URL", kind: "url", required: false, choices: [] },
  ], attachmentDefinitionsJson: [],
});
recordTypes.createRecordType(northstar.id, {
  key: "delivery", name: "Delivery evidence", purpose: "custom", allowMultiple: true,
  fieldDefinitionsJson: [{ key: "reference", label: "Reference", kind: "text", required: false, choices: [] }, { key: "period", label: "Service period", kind: "text", required: false, choices: [] }], attachmentDefinitionsJson: [],
});

type InvoicePlan = { clientId: number; date: string; currency: "USD" | "GBP" | "EUR"; items: Array<{ name: string; value: string; source: "fixed_monthly" | "expense" | "other" }>; notes: string; status: "draft" | "issued" | "sent" | "paid" | "void" };
const plans: InvoicePlan[] = [
  { clientId: northstar.id, date: "2026-08-31", currency: "USD", items: [{ name: "Platform engineering retainer — August 2026", value: "6400.00", source: "fixed_monthly" }, { name: "Observability workshop", value: "850.00", source: "other" }], notes: "Demo fixture — August delivery completed.", status: "paid" },
  { clientId: northstar.id, date: "2026-09-01", currency: "USD", items: [{ name: "Platform engineering retainer — September 2026", value: "6400.00", source: "fixed_monthly" }, { name: "Architecture review", value: "1200.00", source: "other" }], notes: "Demo fixture — payment terms: fictional.", status: "sent" },
  { clientId: briar.id, date: "2026-08-25", currency: "GBP", items: [{ name: "Product development services — August 2026", value: "4850.00", source: "fixed_monthly" }, { name: "Accessibility audit", value: "620.00", source: "other" }], notes: "Demo fixture — foreign-client commercial invoice.", status: "issued" },
  { clientId: lumen.id, date: "2026-09-03", currency: "EUR", items: [{ name: "Software architecture and delivery — September 2026", value: "5700.00", source: "fixed_monthly" }, { name: "Design-system integration", value: "980.00", source: "other" }], notes: "Demo fixture — draft for review.", status: "draft" },
  { clientId: cedar.id, date: "2026-07-31", currency: "USD", items: [{ name: "Maintenance and reliability support — July 2026", value: "3200.00", source: "fixed_monthly" }, { name: "Incident response coverage", value: "450.00", source: "other" }], notes: "Demo fixture — superseded engagement example.", status: "void" },
];

const created = [] as Array<{ id: number; number: string; status: string; pdfPath?: string }>;
for (const plan of plans) {
  const invoice = invoices.createInvoice({ clientId: plan.clientId, invoiceDate: plan.date, currency: plan.currency, numberingMode: "auto", notes: plan.notes, items: plan.items.map((item) => ({ ...item, notes: "" })) });
  let detail = invoices.getInvoiceDetail(invoice.id);
  if (!detail) throw new Error("Invoice fixture vanished");
  if (plan.clientId === northstar.id) {
    const description = invoices.generateNfseDescription(detail);
    invoices.saveNfseDescription(invoice.id, description);
    detail = invoices.getInvoiceDetail(invoice.id)!;
  }
  if (plan.status !== "draft") {
    await invoices.issueInvoice(detail);
    detail = invoices.getInvoiceDetail(invoice.id)!;
    if (plan.status === "sent" || plan.status === "paid" || plan.status === "void") invoices.changeStatus(invoice.id, plan.status);
  }
  const finalDetail = invoices.getInvoiceDetail(invoice.id)!;
  created.push({ id: invoice.id, number: invoice.number, status: finalDetail.invoice.status, ...(finalDetail.archivedPdf ? { pdfPath: absolutePath(finalDetail.archivedPdf) } : {}) });
}

const northstarSent = created.find((invoice) => invoice.status === "sent");
if (northstarSent) {
  const detail = invoices.getInvoiceDetail(northstarSent.id)!;
  const email = invoices.generateCustomText(detail, "client_email");
  invoices.saveCustomText(detail, "client_email", email.content, email.generator.source);
  recordInstances.createInvoiceRecord(detail, nfseType.id, { number: "DEMO-NFSE-2026-0091", issue_date: "2026-09-02", verification_code: "DEMO-VERIFY-91", public_url: "https://nfse-demo.example/verify/91" });
}

db.run("CREATE TABLE IF NOT EXISTS demo_seed_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
db.run("INSERT OR REPLACE INTO demo_seed_meta (key, value) VALUES ('fixture', 'docs-demo-v1')");

console.log(JSON.stringify({ status: "seeded", dataDir: demoDataDir, dbPath: demoDbPath, filesDir: demoFilesDir, invoices: created }, null, 2));
