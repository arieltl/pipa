import type {
  ClientTextGenerator,
  InvoiceGeneratedText,
} from "../../db/schema.ts";
import { invoices } from "../../db/schema.ts";
import { db } from "../../db/client.ts";
import { eq, sql } from "drizzle-orm";
import { nowIso } from "../../domain/dates.ts";
import {
  LiquidSourceError,
  renderLiquidPlainText,
  validateLiquidSource,
} from "../../pdf/html/liquid-engine.ts";
import {
  buildInvoiceDocumentModel,
  type BuildDocumentModelInput,
} from "../../pdf/document-model.ts";
import type { TextGeneratorFormInput } from "./text-generators.schema.ts";
import * as repo from "./text-generators.repository.ts";
import { sampleInvoiceDocument } from "../../pdf/sample-document.ts";

export { LiquidSourceError };

export class TextGeneratorNotFoundError extends Error {
  constructor() {
    super("Text generator was not found");
    this.name = "TextGeneratorNotFoundError";
  }
}

export class TextGeneratorKeyTakenError extends Error {
  constructor() {
    super("That key is already used by this client");
    this.name = "TextGeneratorKeyTakenError";
  }
}

export class TextGeneratorKeyImmutableError extends Error {
  constructor() {
    super("The stable key cannot be changed after creation");
    this.name = "TextGeneratorKeyImmutableError";
  }
}

export class TextGeneratorPurposeTakenError extends Error {
  constructor() {
    super("This client already has an active NFS-e description generator");
    this.name = "TextGeneratorPurposeTakenError";
  }
}

export function listClientTextGenerators(
  clientId: number,
  includeArchived = false,
): Array<ClientTextGenerator & { validationWarning?: string }> {
  return repo.listClientGenerators(clientId, includeArchived).map((generator) => {
    try {
      validateGeneratorSource(generator.source);
      return generator;
    } catch (error) {
      if (!(error instanceof LiquidSourceError)) throw error;
      return { ...generator, validationWarning: `This saved template needs review: ${error.message}. Its original source and saved invoice text have been preserved.` };
    }
  });
}

export function getActiveTextGenerator(
  clientId: number,
  key: string,
): ClientTextGenerator | null {
  return repo.getActiveGeneratorByKey(clientId, key.toLowerCase());
}

export function getNfseTextGenerator(
  clientId: number,
): ClientTextGenerator | null {
  return repo.getActivePurposeGenerator(clientId, "nfse-description");
}

function assertPurposeAvailable(
  clientId: number,
  purpose: string,
  exceptId?: number,
): void {
  if (purpose !== "nfse-description") return;
  const existing = repo.getActivePurposeGenerator(clientId, purpose);
  if (existing && existing.id !== exceptId) {
    throw new TextGeneratorPurposeTakenError();
  }
}

function validateGeneratorSource(source: string): void {
  validateLiquidSource(source);
  renderLiquidPlainText(source, sampleInvoiceDocument);
}

export function createTextGenerator(
  clientId: number,
  input: TextGeneratorFormInput,
): ClientTextGenerator {
  validateGeneratorSource(input.source);
  if (repo.getActiveGeneratorByKey(clientId, input.key)) {
    throw new TextGeneratorKeyTakenError();
  }
  assertPurposeAvailable(clientId, input.purpose);
  const now = nowIso();
  try {
    return repo.insertGenerator({
      clientId,
      key: input.key,
      name: input.name,
      purpose: input.purpose,
      source: input.source,
      position: repo.nextPosition(clientId),
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    });
  } catch (error) {
    if (String(error).includes("UNIQUE constraint failed")) {
      throw new TextGeneratorKeyTakenError();
    }
    throw error;
  }
}

export function updateTextGenerator(
  clientId: number,
  id: number,
  input: TextGeneratorFormInput,
): ClientTextGenerator {
  const current = repo.getGenerator(id);
  if (!current || current.clientId !== clientId || current.archivedAt) {
    throw new TextGeneratorNotFoundError();
  }
  if (input.key !== current.key) throw new TextGeneratorKeyImmutableError();
  validateGeneratorSource(input.source);
  const keyOwner = repo.getActiveGeneratorByKey(clientId, input.key);
  if (keyOwner && keyOwner.id !== id) throw new TextGeneratorKeyTakenError();
  assertPurposeAvailable(clientId, input.purpose, id);
  try {
    return repo.updateGeneratorRow(id, {
      key: input.key,
      name: input.name,
      purpose: input.purpose,
      source: input.source,
      updatedAt: nowIso(),
    });
  } catch (error) {
    if (String(error).includes("UNIQUE constraint failed")) {
      throw new TextGeneratorKeyTakenError();
    }
    throw error;
  }
}

export function archiveTextGenerator(clientId: number, id: number): void {
  const current = repo.getGenerator(id);
  if (!current || current.clientId !== clientId || current.archivedAt) {
    throw new TextGeneratorNotFoundError();
  }
  repo.updateGeneratorRow(id, {
    archivedAt: nowIso(),
    updatedAt: nowIso(),
  });
}

export function generateText(
  generator: ClientTextGenerator,
  detail: BuildDocumentModelInput,
): string {
  if (generator.archivedAt) throw new TextGeneratorNotFoundError();
  return renderLiquidPlainText(
    generator.source,
    buildInvoiceDocumentModel(detail),
  );
}

export function listSavedGeneratedTexts(
  invoiceId: number,
): InvoiceGeneratedText[] {
  return repo.listInvoiceGeneratedTexts(invoiceId);
}

export function getSavedGeneratedText(
  invoiceId: number,
  key: string,
): InvoiceGeneratedText | null {
  return repo.getInvoiceGeneratedText(invoiceId, key);
}

export function saveGeneratedText(
  invoiceId: number,
  generator: ClientTextGenerator,
  content: string,
  sourceSnapshot = generator.source,
): InvoiceGeneratedText {
  const now = nowIso();
  return db.transaction(() => { const saved=repo.upsertInvoiceGeneratedText({
    invoiceId,
    generatorId: generator.id,
    generatorKey: generator.key,
    generatorName: generator.name,
    sourceSnapshot,
    content: content.trim(),
    createdAt: now,
    updatedAt: now,
  }); db.update(invoices).set({workspaceRevision:sql`${invoices.workspaceRevision} + 1`,updatedAt:nowIso()}).where(eq(invoices.id,invoiceId)).run();return saved; });
}

export function saveGeneratedTextSnapshot(
  invoiceId: number,
  key: string,
  name: string,
  content: string,
  sourceSnapshot = "",
): InvoiceGeneratedText {
  const now = nowIso();
  return db.transaction(() => { const saved=repo.upsertInvoiceGeneratedText({
    invoiceId,
    generatorId: null,
    generatorKey: key,
    generatorName: name,
    sourceSnapshot,
    content: content.trim(),
    createdAt: now,
    updatedAt: now,
  }); db.update(invoices).set({workspaceRevision:sql`${invoices.workspaceRevision} + 1`,updatedAt:nowIso()}).where(eq(invoices.id,invoiceId)).run();return saved; });
}
