import { and, asc, desc, eq, isNull, max } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { pdfTemplateRevisions, pdfTemplates, type PdfTemplate, type PdfTemplateRevision } from "../../db/schema.ts";

export function listTemplates(engine?: string): PdfTemplate[] {
  return db.select().from(pdfTemplates).where(engine ? and(eq(pdfTemplates.engine, engine), isNull(pdfTemplates.archivedAt)) : isNull(pdfTemplates.archivedAt)).orderBy(asc(pdfTemplates.name)).all();
}
export function getTemplate(id: number): PdfTemplate | null { return db.select().from(pdfTemplates).where(eq(pdfTemplates.id, id)).get() ?? null; }
export function getRevision(id: number): PdfTemplateRevision | null { return db.select().from(pdfTemplateRevisions).where(eq(pdfTemplateRevisions.id, id)).get() ?? null; }
export function getBuiltinClassic(): PdfTemplate | null { return db.select().from(pdfTemplates).where(eq(pdfTemplates.stableKey, "builtin-react-classic")).get() ?? null; }
export function getActiveCurrentRevision(templateId: number): PdfTemplateRevision | null {
  const template = db.select().from(pdfTemplates).where(and(eq(pdfTemplates.id, templateId), isNull(pdfTemplates.archivedAt))).get();
  return template?.currentRevisionId ? getRevision(template.currentRevisionId) : null;
}

export function listRevisions(templateId: number): PdfTemplateRevision[] {
  return db
    .select()
    .from(pdfTemplateRevisions)
    .where(eq(pdfTemplateRevisions.templateId, templateId))
    .orderBy(desc(pdfTemplateRevisions.revision))
    .all();
}

export function insertHtmlTemplate(values: {
  name: string;
  source: string;
  contentSha256: string;
  createdAt: string;
}): PdfTemplate {
  return db.transaction((tx) => {
    const template = tx
      .insert(pdfTemplates)
      .values({
        stableKey: null,
        name: values.name,
        engine: "gotenberg-html",
        sourceKind: "user",
        currentRevisionId: null,
        archivedAt: null,
        createdAt: values.createdAt,
        updatedAt: values.createdAt,
      })
      .returning()
      .get();
    const revision = tx
      .insert(pdfTemplateRevisions)
      .values({
        templateId: template.id,
        revision: 1,
        rendererKey: null,
        source: values.source,
        configurationJson: "{}",
        contentSha256: values.contentSha256,
        createdAt: values.createdAt,
      })
      .returning()
      .get();
    return tx
      .update(pdfTemplates)
      .set({ currentRevisionId: revision.id })
      .where(eq(pdfTemplates.id, template.id))
      .returning()
      .get();
  });
}

export function insertRevision(values: {
  templateId: number;
  name: string;
  source: string;
  contentSha256: string;
  createdAt: string;
}): PdfTemplateRevision {
  return db.transaction((tx) => {
    const row = tx
      .select({ value: max(pdfTemplateRevisions.revision) })
      .from(pdfTemplateRevisions)
      .where(eq(pdfTemplateRevisions.templateId, values.templateId))
      .get();
    const revision = tx
      .insert(pdfTemplateRevisions)
      .values({
        templateId: values.templateId,
        revision: (row?.value ?? 0) + 1,
        rendererKey: null,
        source: values.source,
        configurationJson: "{}",
        contentSha256: values.contentSha256,
        createdAt: values.createdAt,
      })
      .returning()
      .get();
    tx.update(pdfTemplates)
      .set({
        name: values.name,
        currentRevisionId: revision.id,
        updatedAt: values.createdAt,
      })
      .where(eq(pdfTemplates.id, values.templateId))
      .run();
    return revision;
  });
}
