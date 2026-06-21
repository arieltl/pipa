import { eq } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { files, type FileRecord, type NewFileRecord } from "../../db/schema.ts";
import { nowIso } from "../../domain/dates.ts";

/** Insert a stored-file metadata row. */
export function insertFile(
  input: Omit<NewFileRecord, "id" | "createdAt">,
): FileRecord {
  return db
    .insert(files)
    .values({ ...input, createdAt: nowIso() })
    .returning()
    .get();
}

export function getFileById(id: number): FileRecord | null {
  return db.select().from(files).where(eq(files.id, id)).get() ?? null;
}

/**
 * Mark `oldId` as superseded by `newId` (spec §21 — supersede, never overwrite).
 * The bytes on disk are retained; only the metadata link changes.
 */
export function markSuperseded(oldId: number, newId: number): void {
  db.update(files)
    .set({ supersededByFileId: newId })
    .where(eq(files.id, oldId))
    .run();
}
