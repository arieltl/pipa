import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync as readMigration } from "node:fs";

const legacyMigrations = [
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

function migrationSource(filename: string) {
  return readMigration(join(import.meta.dir, "../../drizzle", filename), "utf8");
}

function apply(database: Database, filenames: string[]) {
  for (const filename of filenames) {
    for (const statement of migrationSource(filename).split("--> statement-breakpoint")) {
      if (statement.trim()) database.exec(statement);
    }
  }
}

function createLegacyDatabase() {
  const dir = mkdtempSync(join(tmpdir(), "pipa-workspace-migration-"));
  const database = new Database(join(dir, "legacy.db"));
  database.exec("PRAGMA foreign_keys = ON");
  apply(database, legacyMigrations);
  const now = "2026-09-09T12:00:00.000Z";
  database.query("INSERT INTO clients (id,name,code,created_at,updated_at) VALUES (1,'One','ONE',?,?)").run(now, now);
  database.query("INSERT INTO clients (id,name,code,created_at,updated_at) VALUES (2,'Two','TWO',?,?)").run(now, now);
  database.query("INSERT INTO invoices (id,client_id,number,invoice_date,created_at,updated_at) VALUES (1,1,'ONE-1','2026-09-09',?,?)").run(now, now);
  database.query("INSERT INTO invoices (id,client_id,number,invoice_date,created_at,updated_at) VALUES (2,2,'TWO-1','2026-09-09',?,?)").run(now, now);
  return { database, dir, now };
}

function insertFile(database: Database, id: number, path: string, now: string, supersededBy: number | null = null, kind = "archived_invoice") {
  database.query("INSERT INTO files (id,kind,stored_path,mime_type,size_bytes,sha256,superseded_by_file_id,created_at) VALUES (?,?,?,?,?,?,?,?)")
    .run(id, kind, path, "application/pdf", 7, `sha-${id}`, supersededBy, now);
}

describe("workspace ownership migration", () => {
  test("backfills a predecessor chain longer than 100 without claiming an unowned same-kind file or changing legacy bytes and ids", () => {
    const { database, dir, now } = createLegacyDatabase();
    try {
      const filePath = join(dir, "archived-1.pdf");
      writeFileSync(filePath, "bytes-1");
      for (let id = 1; id <= 125; id++) insertFile(database, id, id === 1 ? filePath : `archive-${id}.pdf`, now, id === 125 ? null : id + 1);
      insertFile(database, 126, "unowned-archive.pdf", now);
      // A completed replacement points the invoice at the current file; the
      // migration walks backward through its predecessors to retain history.
      database.query("UPDATE invoices SET archived_pdf_file_id=125 WHERE id=1").run();

      // 0008 already created this legacy record/attachment shape; it must remain stable.
      insertFile(database, 127, "nfse.pdf", now, null, "nfse_pdf");
      database.query("INSERT INTO nota_fiscal_links (invoice_id,pdf_file_id,created_at,updated_at) VALUES (1,127,?,?)").run(now, now);
      database.query("INSERT INTO invoice_records (id,invoice_id,record_type_key,record_type_name,purpose,definitions_snapshot_json,values_json,created_at,updated_at) VALUES (1,1,'nfse','NFS-e','nfse','{}','{}',?,?)").run(now, now);
      database.query("INSERT INTO invoice_record_attachments (id,invoice_record_id,definition_key,stored_file_id,created_at) VALUES (1,1,'pdf',127,?)").run(now);
      const recordBefore = database.query("SELECT id FROM invoice_records WHERE invoice_id=1 AND purpose='nfse'").get() as { id: number };
      const attachmentBefore = database.query("SELECT id FROM invoice_record_attachments WHERE invoice_record_id=? AND stored_file_id=127").get(recordBefore.id) as { id: number };

      apply(database, ["0009_ambiguous_war_machine.sql", "0010_goofy_preak.sql"]);

      const owned = database.query("SELECT file_id FROM invoice_file_ownership WHERE invoice_id=1 ORDER BY file_id").all() as Array<{ file_id: number }>;
      expect(owned.map(({ file_id }) => file_id)).toEqual([...Array(125).keys()].map((index) => index + 1).concat(127));
      expect(database.query("SELECT count(*) AS count FROM invoice_file_ownership WHERE file_id=126").get()).toEqual({ count: 0 });
      expect(database.query("SELECT id FROM invoice_records WHERE invoice_id=1 AND purpose='nfse'").get()).toEqual(recordBefore);
      expect(database.query("SELECT id FROM invoice_record_attachments WHERE invoice_record_id=? AND stored_file_id=127").get(recordBefore.id)).toEqual(attachmentBefore);
      expect(database.query("SELECT id,stored_path,size_bytes,sha256 FROM files WHERE id=1").get()).toEqual({ id: 1, stored_path: filePath, size_bytes: 7, sha256: "sha-1" });
      expect(readFileSync(filePath).toString()).toBe("bytes-1");
    } finally {
      database.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("terminates a cyclic predecessor chain and assigns every cycle member once", () => {
    const { database, dir, now } = createLegacyDatabase();
    try {
      insertFile(database, 1, "cycle-1.pdf", now, 2);
      insertFile(database, 2, "cycle-2.pdf", now, 3);
      insertFile(database, 3, "cycle-3.pdf", now, 1);
      database.query("UPDATE invoices SET archived_pdf_file_id=1 WHERE id=1").run();

      apply(database, ["0009_ambiguous_war_machine.sql", "0010_goofy_preak.sql"]);

      expect(database.query("SELECT file_id FROM invoice_file_ownership WHERE invoice_id=1 ORDER BY file_id").all())
        .toEqual([{ file_id: 1 }, { file_id: 2 }, { file_id: 3 }]);
    } finally {
      database.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("aborts when a legacy file has provable owners on different invoices", () => {
    const { database, dir, now } = createLegacyDatabase();
    try {
      insertFile(database, 1, "shared.pdf", now);
      database.query("UPDATE invoices SET archived_pdf_file_id=1 WHERE id=1").run();
      database.query("INSERT INTO nota_fiscal_links (invoice_id,pdf_file_id,created_at,updated_at) VALUES (2,1,?,?)").run(now, now);

      expect(() => apply(database, ["0009_ambiguous_war_machine.sql"])).toThrow();
      expect(database.query("SELECT count(*) AS count FROM invoice_file_ownership").get()).toEqual({ count: 0 });
    } finally {
      database.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
