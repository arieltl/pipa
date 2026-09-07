import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { existsSync } from "node:fs";
import { db } from "./client.ts";
import { seedNumberingProfiles, seedPdfTemplates } from "./seed.ts";
import { paths, ensureDataDirs } from "../config/paths.ts";
import { extractEmbeddedRuntimeFiles } from "../runtime/embedded-runtime.ts";

function migrationsFolder(): string {
  return existsSync(paths.runtimeMigrationsDir) ? paths.runtimeMigrationsDir : "./drizzle";
}

/**
 * Apply all pending migrations, then run idempotent seeds.
 * Called at server startup and runnable directly via `bun run db:migrate`.
 */
export function runMigrations(): void {
  migrate(db, { migrationsFolder: migrationsFolder() });
  seedNumberingProfiles();
  seedPdfTemplates();
}

if (import.meta.main) {
  ensureDataDirs();
  extractEmbeddedRuntimeFiles();
  runMigrations();
  console.log("✓ migrations applied");
}
