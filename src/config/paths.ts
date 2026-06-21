import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { env } from "./env.ts";

/**
 * Filesystem layout derived from env config. See architecture plan §"File
 * Storage" and spec §19. Paths are computed here so the rest of the app never
 * hand-builds storage paths.
 */
export const paths = {
  dataDir: env.dataDir,
  dbPath: env.dbPath,
  filesDir: env.filesDir,
  tmpDir: env.tmpDir,

  archivedInvoicesDir: join(env.filesDir, "archived", "invoices"),
  generatedInvoicesDir: join(env.filesDir, "generated", "invoices"),
  nfseDir: join(env.filesDir, "nfse"),
  expenseAttachmentsDir: join(env.filesDir, "attachments", "expenses"),
} as const;

/**
 * Create the directories the app expects to exist. Safe to call repeatedly.
 * The SQLite file itself is created by the driver; we only ensure its parent.
 */
export function ensureDataDirs(): void {
  for (const dir of [
    paths.dataDir,
    paths.filesDir,
    paths.tmpDir,
    paths.archivedInvoicesDir,
    paths.generatedInvoicesDir,
    paths.nfseDir,
    paths.expenseAttachmentsDir,
  ]) {
    mkdirSync(dir, { recursive: true });
  }
}
