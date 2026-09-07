import { and, asc, eq, isNull, max } from "drizzle-orm";
import { db } from "../../db/client.ts";
import {
  clientTextGenerators,
  invoiceGeneratedTexts,
  type ClientTextGenerator,
  type InvoiceGeneratedText,
  type NewClientTextGenerator,
} from "../../db/schema.ts";

export function listClientGenerators(
  clientId: number,
  includeArchived = false,
): ClientTextGenerator[] {
  return db
    .select()
    .from(clientTextGenerators)
    .where(
      includeArchived
        ? eq(clientTextGenerators.clientId, clientId)
        : and(
            eq(clientTextGenerators.clientId, clientId),
            isNull(clientTextGenerators.archivedAt),
          ),
    )
    .orderBy(asc(clientTextGenerators.position), asc(clientTextGenerators.name))
    .all();
}

export function getGenerator(id: number): ClientTextGenerator | null {
  return (
    db
      .select()
      .from(clientTextGenerators)
      .where(eq(clientTextGenerators.id, id))
      .get() ?? null
  );
}

export function getActiveGeneratorByKey(
  clientId: number,
  key: string,
): ClientTextGenerator | null {
  return (
    db
      .select()
      .from(clientTextGenerators)
      .where(
        and(
          eq(clientTextGenerators.clientId, clientId),
          eq(clientTextGenerators.key, key),
          isNull(clientTextGenerators.archivedAt),
        ),
      )
      .get() ?? null
  );
}

export function getActivePurposeGenerator(
  clientId: number,
  purpose: string,
): ClientTextGenerator | null {
  return (
    db
      .select()
      .from(clientTextGenerators)
      .where(
        and(
          eq(clientTextGenerators.clientId, clientId),
          eq(clientTextGenerators.purpose, purpose),
          isNull(clientTextGenerators.archivedAt),
        ),
      )
      .get() ?? null
  );
}

export function nextPosition(clientId: number): number {
  const row = db
    .select({ value: max(clientTextGenerators.position) })
    .from(clientTextGenerators)
    .where(eq(clientTextGenerators.clientId, clientId))
    .get();
  return (row?.value ?? -1) + 1;
}

export function insertGenerator(
  values: NewClientTextGenerator,
): ClientTextGenerator {
  return db.insert(clientTextGenerators).values(values).returning().get();
}

export function updateGeneratorRow(
  id: number,
  values: Partial<NewClientTextGenerator>,
): ClientTextGenerator {
  return db
    .update(clientTextGenerators)
    .set(values)
    .where(eq(clientTextGenerators.id, id))
    .returning()
    .get();
}

export function listInvoiceGeneratedTexts(
  invoiceId: number,
): InvoiceGeneratedText[] {
  return db
    .select()
    .from(invoiceGeneratedTexts)
    .where(eq(invoiceGeneratedTexts.invoiceId, invoiceId))
    .all();
}

export function getInvoiceGeneratedText(
  invoiceId: number,
  key: string,
): InvoiceGeneratedText | null {
  return (
    db
      .select()
      .from(invoiceGeneratedTexts)
      .where(
        and(
          eq(invoiceGeneratedTexts.invoiceId, invoiceId),
          eq(invoiceGeneratedTexts.generatorKey, key),
        ),
      )
      .get() ?? null
  );
}

export function upsertInvoiceGeneratedText(values: {
  invoiceId: number;
  generatorId: number | null;
  generatorKey: string;
  generatorName: string;
  sourceSnapshot: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}): InvoiceGeneratedText {
  return db
    .insert(invoiceGeneratedTexts)
    .values(values)
    .onConflictDoUpdate({
      target: [
        invoiceGeneratedTexts.invoiceId,
        invoiceGeneratedTexts.generatorKey,
      ],
      set: {
        generatorId: values.generatorId,
        generatorName: values.generatorName,
        sourceSnapshot: values.sourceSnapshot,
        content: values.content,
        updatedAt: values.updatedAt,
      },
    })
    .returning()
    .get();
}
