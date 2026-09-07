import { eq, max, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db } from "./client.ts";
import {
  numberingProfiles,
  pdfTemplateRevisions,
  pdfTemplates,
} from "./schema.ts";
import { nowIso } from "../domain/dates.ts";
import classicHtmlSource from "../pdf/html/templates/classic.liquid" with { type: "text" };

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

const BUILTIN_PDF_TEMPLATES = [
  {
    stableKey: "builtin-react-classic",
    name: "Classic",
    engine: "react-pdf",
    rendererKey: "classic",
    source: null,
    contentSha256: "builtin-react-classic-v1",
  },
  {
    stableKey: "builtin-html-classic",
    name: "Classic HTML",
    engine: "gotenberg-html",
    rendererKey: null,
    source: classicHtmlSource,
    contentSha256: createHash("sha256").update(classicHtmlSource).digest("hex"),
  },
] as const;

/**
 * Built-ins are identities plus immutable revisions. Running this seed again
 * is a no-op unless code-shipped source changes, in which case it appends a
 * revision and moves only the built-in's current pointer.
 */
export function seedPdfTemplates(): void {
  const now = nowIso();
  for (const builtin of BUILTIN_PDF_TEMPLATES) {
    db.transaction((tx) => {
      let template = tx
        .select()
        .from(pdfTemplates)
        .where(eq(pdfTemplates.stableKey, builtin.stableKey))
        .get();
      if (!template) {
        template = tx
          .insert(pdfTemplates)
          .values({
            stableKey: builtin.stableKey,
            name: builtin.name,
            engine: builtin.engine,
            sourceKind: "builtin",
            currentRevisionId: null,
            archivedAt: null,
            createdAt: now,
            updatedAt: now,
          })
          .returning()
          .get();
      }

      const current = template.currentRevisionId
        ? tx
            .select()
            .from(pdfTemplateRevisions)
            .where(eq(pdfTemplateRevisions.id, template.currentRevisionId))
            .get()
        : null;
      if (current?.contentSha256 === builtin.contentSha256) return;

      const latest = tx
        .select({ value: max(pdfTemplateRevisions.revision) })
        .from(pdfTemplateRevisions)
        .where(eq(pdfTemplateRevisions.templateId, template.id))
        .get();
      const revision = tx
        .insert(pdfTemplateRevisions)
        .values({
          templateId: template.id,
          revision: (latest?.value ?? 0) + 1,
          rendererKey: builtin.rendererKey,
          source: builtin.source,
          configurationJson: "{}",
          contentSha256: builtin.contentSha256,
          createdAt: now,
        })
        .returning()
        .get();
      tx.update(pdfTemplates)
        .set({
          name: builtin.name,
          engine: builtin.engine,
          sourceKind: "builtin",
          currentRevisionId: revision.id,
          archivedAt: null,
          updatedAt: now,
        })
        .where(eq(pdfTemplates.id, template.id))
        .run();
    });
  }
}
