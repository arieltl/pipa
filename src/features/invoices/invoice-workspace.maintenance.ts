import { existsSync, unlinkSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { paths } from "../../config/paths.ts";
import { nowIso } from "../../domain/dates.ts";
import { files, invoiceEditSessions, invoiceOperations, invoiceStagedFiles } from "../../db/schema.ts";

const LIMIT = 100;

/**
 * Releases only expired, uncommitted staging. Database eligibility is made
 * durable before touching disk so reruns can safely retry an interrupted unlink.
 */
export function maintainWorkspaceState(now = nowIso()) {
  const releasePaths = db.transaction((tx) => {
    const expired = tx.select().from(invoiceOperations).where(and(eq(invoiceOperations.state, "processing"), sql`${invoiceOperations.leaseExpiresAt} is not null and ${invoiceOperations.leaseExpiresAt} <= ${now}`)).limit(LIMIT).all();
    for (const operation of expired) {
      const result = JSON.stringify({ outcome: "rejected", operationId: operation.id, kind: operation.kind, digest: operation.digest, code: "OPERATION_EXPIRED", message: "The unfinished operation expired before a commit receipt was published." });
      tx.update(invoiceOperations).set({ state: "rejected", resultJson: result, fencingGeneration: operation.fencingGeneration + 1, leaseExpiresAt: null, updatedAt: now }).where(and(eq(invoiceOperations.invoiceId, operation.invoiceId), eq(invoiceOperations.id, operation.id), eq(invoiceOperations.state, "processing"), eq(invoiceOperations.fencingGeneration, operation.fencingGeneration))).run();
    }
    const candidates = tx.select().from(invoiceStagedFiles).where(and(eq(invoiceStagedFiles.state, "staged"), sql`${invoiceStagedFiles.expiresAt} <= ${now}`)).limit(LIMIT).all();
    let released = 0;
    for (const staged of candidates) {
      if (!eligibleForRelease(tx, staged.sessionId, now)) continue;
      if (tx.update(invoiceStagedFiles).set({ state: "released" }).where(and(eq(invoiceStagedFiles.token, staged.token), eq(invoiceStagedFiles.state, "staged"))).returning({ token: invoiceStagedFiles.token }).get()) released++;
    }

    // Released rows are intentionally retried: an earlier unlink may have
    // failed after its durable state transition. Recheck pins before handing a
    // path to the non-transactional filesystem phase.
    const unlinkable = tx.select().from(invoiceStagedFiles).where(and(eq(invoiceStagedFiles.state, "released"), sql`${invoiceStagedFiles.storedPath} glob ${stagePathGlob()}`)).limit(LIMIT).all()
      .filter((staged) => eligibleForRelease(tx, staged.sessionId, now) && !hasDurableFileReference(tx, staged.storedPath))
      .map(({ token, storedPath }) => ({ token, storedPath }));
    return { expiredOperations: expired.length, released, unlinkable };
  });

  let unlinked = 0;
  for (const staged of releasePaths.unlinkable) {
    if (!isStagePath(staged.storedPath)) continue;
    try {
      if (existsSync(staged.storedPath)) unlinkSync(staged.storedPath);
      db.delete(invoiceStagedFiles).where(and(eq(invoiceStagedFiles.token, staged.token), eq(invoiceStagedFiles.state, "released"))).run();
      unlinked++;
    } catch { /* retain released metadata for a later safe retry */ }
  }

  // Lease-limited plaintext can disappear only once no live operation pins it.
  const prunedSessions = db.transaction((tx) => {
    const sessions = tx.select().from(invoiceEditSessions).where(sql`${invoiceEditSessions.expiresAt} <= ${now}`).limit(LIMIT).all();
    let count = 0;
    for (const session of sessions) {
      const processing = tx.select({ id: invoiceOperations.id }).from(invoiceOperations).where(and(eq(invoiceOperations.sessionId, session.id), eq(invoiceOperations.state, "processing"))).get();
      const staged = tx.select({ token: invoiceStagedFiles.token }).from(invoiceStagedFiles).where(and(eq(invoiceStagedFiles.sessionId, session.id), sql`${invoiceStagedFiles.state} in ('staged', 'released')`)).get();
      if (processing || staged) continue;
      tx.delete(invoiceEditSessions).where(eq(invoiceEditSessions.id, session.id)).run();
      count++;
    }
    return count;
  });
  return { expiredOperations: releasePaths.expiredOperations, released: releasePaths.released, unlinked, prunedSessions };
}

function eligibleForRelease(tx: any, sessionId: string, now: string) {
  const active = tx.select({ id: invoiceOperations.id }).from(invoiceOperations).where(and(eq(invoiceOperations.sessionId, sessionId), eq(invoiceOperations.state, "processing"))).get();
  if (active) return false;
  const session = tx.select().from(invoiceEditSessions).where(eq(invoiceEditSessions.id, sessionId)).get();
  return Boolean(session && (session.state !== "active" || session.expiresAt <= now));
}

function hasDurableFileReference(tx: any, storedPath: string) {
  const file = tx.select({ id: files.id }).from(files).where(eq(files.storedPath, storedPath)).get();
  // Any file row can subsequently be owned; staging is never allowed to
  // unlink a path that has crossed into durable file metadata.
  return Boolean(file);
}

function isStagePath(path: string) {
  const candidate = resolve(path);
  return dirname(candidate) === resolve(paths.tmpDir) && /^invoice-stage-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(basename(candidate));
}

function stagePathGlob() {
  const hex = "[0-9A-Fa-f]";
  return `${resolve(paths.tmpDir)}/invoice-stage-${hex.repeat(8)}-${hex.repeat(4)}-${hex.repeat(4)}-${hex.repeat(4)}-${hex.repeat(12)}`;
}
