import { sql } from "drizzle-orm";
import { db } from "./client.ts";
import { numberingProfiles } from "./schema.ts";
import { nowIso } from "../domain/dates.ts";

/**
 * Default numbering profiles so clients have something to reference before the
 * profile-management UI lands (Phase 3). Idempotent: only seeds when the table
 * is empty, so it never clobbers user edits.
 */
const DEFAULT_PROFILES = [
  {
    name: "Monthly per client",
    pattern: "{CLIENT_CODE}-{YYYYMM}-{SEQ:02}",
    resetPeriod: "monthly",
  },
  {
    name: "Yearly per client",
    pattern: "{CLIENT_CODE}-{YYYY}-{SEQ:03}",
    resetPeriod: "yearly",
  },
  {
    name: "Sequential per client",
    pattern: "{CLIENT_CODE}-{SEQ:04}",
    resetPeriod: "never",
  },
] as const;

export function seedNumberingProfiles(): void {
  const [row] = db
    .select({ count: sql<number>`count(*)` })
    .from(numberingProfiles)
    .all();
  if (row && row.count > 0) return;

  const now = nowIso();
  db.insert(numberingProfiles)
    .values(
      DEFAULT_PROFILES.map((p) => ({ ...p, createdAt: now, updatedAt: now })),
    )
    .run();
}
