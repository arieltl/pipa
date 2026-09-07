import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationFiles = [
  "0000_mushy_the_call.sql",
  "0001_wooden_joseph.sql",
  "0002_volatile_wither.sql",
  "0003_lazy_night_thrasher.sql",
  "0004_structured_bank_details.sql",
  "0005_fresh_warhawk.sql",
  "0006_woozy_beyonder.sql",
  "0007_builtin_html_classic.sql",
  "0008_bizarre_valeria_richards.sql",
];

function apply(database: Database, filenames: string[]) {
  for (const filename of filenames) {
    const source = readFileSync(join(import.meta.dir, "../../drizzle", filename), "utf8");
    for (const statement of source.split("--> statement-breakpoint")) {
      if (statement.trim()) database.exec(statement);
    }
  }
}

describe("party/template migration", () => {
  test("backfills representative legacy data without touching archived file metadata", () => {
    const database = new Database(":memory:");
    database.exec("PRAGMA foreign_keys = ON");
    try {
      apply(database, migrationFiles.slice(0, 5));
      const now = "2026-06-30T12:00:00.000Z";
      database
        .query("INSERT INTO numbering_profiles (id,name,pattern,reset_period,created_at,updated_at) VALUES (1,'Monthly','{CLIENT_CODE}-{YYYYMM}-{SEQ:02}','monthly',?,?)")
        .run(now, now);
      database
        .query(`INSERT INTO issuer_settings
          (id,name,legal_name,cnpj,address,email,bank_details,pix_key,default_currency,created_at,updated_at,bank_beneficiary,bank_iban,bank_swift_code)
          VALUES (1,'Studio','Studio Legal','00.000.000/0001-00','Issuer address','issuer@example.test','Pay in full','pix@example.test','GBP',?,?,'Studio Legal','GB82WEST12345698765432','DEUTDEFF')`)
        .run(now, now);
      database
        .query(`INSERT INTO clients
          (id,name,legal_name,code,address,country,email,default_currency,default_nfse_description_template,numbering_profile_id,created_at,updated_at)
          VALUES (1,'Customer','Customer Ltd','CUSTOMER','Customer address','United Kingdom','ap@example.test','GBP','Original {{ invoice.number }}',1,?,?)`)
        .run(now, now);
      database
        .query("INSERT INTO files (id,kind,stored_path,mime_type,size_bytes,sha256,created_at) VALUES (1,'archived_invoice','archived/invoices/2026/original.pdf','application/pdf',123,'unchanged-hash',?)")
        .run(now);
      database
        .query(`INSERT INTO invoices
          (id,client_id,number,numbering_profile_id,invoice_date,currency,status,nfse_description,created_at,updated_at,archived_pdf_file_id)
          VALUES (1,1,'CUSTOMER-202606-01',1,'2026-06-30','GBP','issued','Saved NFS-e text',?,?,1)`)
        .run(now, now);
      database
        .query("INSERT INTO nota_fiscal_links (invoice_id,nf_number,issue_date,verification_code,public_url,notes,created_at,updated_at) VALUES (1,'NF-42','2026-07-01','VERIFY','https://example.test/nf/42','Legacy note',?,?)")
        .run(now, now);

      apply(database, migrationFiles.slice(5));

      const client = database
        .query("SELECT party_fields_json, default_pdf_template_id FROM clients WHERE id=1")
        .get() as { party_fields_json: string; default_pdf_template_id: number | null };
      const clientFields = JSON.parse(client.party_fields_json) as Array<{ key: string; value: string }>;
      expect(clientFields.find((field) => field.key === "legal_name")?.value).toBe("Customer Ltd");
      expect(clientFields.find((field) => field.key === "country")?.value).toBe("United Kingdom");

      const invoice = database
        .query("SELECT issuer_snapshot_json, client_snapshot_json, pdf_template_revision_id FROM invoices WHERE id=1")
        .get() as { issuer_snapshot_json: string; client_snapshot_json: string; pdf_template_revision_id: number };
      expect(JSON.parse(invoice.issuer_snapshot_json).fields.some((field: { key: string }) => field.key === "br_cnpj")).toBe(true);
      expect(JSON.parse(invoice.client_snapshot_json).name).toBe("Customer");
      expect(invoice.pdf_template_revision_id).toBeNumber();

      const generator = database
        .query("SELECT source FROM client_text_generators WHERE client_id=1 AND key='nfse_description'")
        .get() as { source: string };
      expect(generator.source).toBe("Original {{ invoice.number }}");
      const output = database
        .query("SELECT content FROM invoice_generated_texts WHERE invoice_id=1 AND generator_key='nfse_description'")
        .get() as { content: string };
      expect(output.content).toBe("Saved NFS-e text");

      const recordType = database.query("SELECT key, purpose FROM client_invoice_record_types WHERE client_id=1").get();
      expect(recordType).toEqual({ key: "nfse", purpose: "nfse" });
      const migratedRecord = database.query("SELECT record_type_key, purpose, values_json FROM invoice_records WHERE invoice_id=1").get() as { record_type_key: string; purpose: string; values_json: string };
      expect(migratedRecord.record_type_key).toBe("nfse");
      expect(JSON.parse(migratedRecord.values_json)).toMatchObject({ number: "NF-42", verification_code: "VERIFY", notes: "Legacy note" });

      expect(
        database.query("SELECT stored_path, size_bytes, sha256 FROM files WHERE id=1").get(),
      ).toEqual({
        stored_path: "archived/invoices/2026/original.pdf",
        size_bytes: 123,
        sha256: "unchanged-hash",
      });
    } finally {
      database.close();
    }
  });
});
