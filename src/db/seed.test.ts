import { describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { db } from "./client.ts";
import { pdfTemplateRevisions, pdfTemplates } from "./schema.ts";
import { seedPdfTemplates } from "./seed.ts";

describe("PDF template built-in seed", () => {
  test("is idempotent and leaves both built-ins with current revisions", () => {
    seedPdfTemplates();
    const before = db
      .select({ count: sql<number>`count(*)` })
      .from(pdfTemplateRevisions)
      .get()!.count;
    seedPdfTemplates();
    const after = db
      .select({ count: sql<number>`count(*)` })
      .from(pdfTemplateRevisions)
      .get()!.count;

    expect(after).toBe(before);
    for (const key of ["builtin-react-classic", "builtin-html-classic"]) {
      const template = db
        .select()
        .from(pdfTemplates)
        .where(eq(pdfTemplates.stableKey, key))
        .get();
      expect(template?.currentRevisionId).toBeNumber();
    }
  });
});
