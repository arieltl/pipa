import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { db } from "./client.ts";
import { seedNumberingProfiles } from "./seed.ts";

/**
 * Apply all pending migrations from ./drizzle, then run idempotent seeds.
 * Called at server startup and runnable directly via `bun run db:migrate`.
 */
export function runMigrations(): void {
  migrate(db, { migrationsFolder: "./drizzle" });
  seedNumberingProfiles();
}

if (import.meta.main) {
  runMigrations();
  console.log("✓ migrations applied");
}
