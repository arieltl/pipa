import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Test bootstrap (see bunfig.toml `[test].preload`).
 *
 * Every test process gets a fresh, isolated SQLite database under the OS temp
 * directory so tests never touch the developer's `./data/app.db`. The env vars
 * must be set BEFORE the db client module is imported, hence the dynamic import
 * of the migrator below.
 */
const dir = mkdtempSync(join(tmpdir(), "invoice-test-"));
process.env.DATA_DIR = dir;
process.env.DB_PATH = join(dir, "test.db");
process.env.FILES_DIR = join(dir, "files");
process.env.TMP_DIR = join(dir, "tmp");

const { ensureDataDirs } = await import("../src/config/paths.ts");
const { extractEmbeddedRuntimeFiles } = await import("../src/runtime/embedded-runtime.ts");
const { runMigrations } = await import("../src/db/migrate.ts");
ensureDataDirs();
extractEmbeddedRuntimeFiles();
runMigrations();
