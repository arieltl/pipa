import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "../../db/client.ts";
import {
  clients,
  files,
  invoiceItems,
  invoiceSequences,
  invoices,
  notaFiscalLinks,
  type Client,
  type FileRecord,
  type Invoice,
  type InvoiceItem,
  type NewInvoice,
  type NewInvoiceItem,
  type NotaFiscalLink,
} from "../../db/schema.ts";
import { nowIso } from "../../domain/dates.ts";

export type InvoiceListRow = Invoice & {
  clientName: string;
  clientCode: string;
  total: number;
};

/** Invoices with their client name/code and computed total, newest first. */
export function listInvoices(): InvoiceListRow[] {
  const rows = db
    .select({
      invoice: invoices,
      clientName: clients.name,
      clientCode: clients.code,
      total: sql<number>`coalesce((
        select sum(${invoiceItems.value})
        from ${invoiceItems}
        where ${invoiceItems.invoiceId} = ${invoices.id}
      ), 0)`,
    })
    .from(invoices)
    .innerJoin(clients, eq(invoices.clientId, clients.id))
    .orderBy(desc(invoices.createdAt))
    .all();

  return rows.map((r) => ({
    ...r.invoice,
    clientName: r.clientName,
    clientCode: r.clientCode,
    total: r.total,
  }));
}

export function getInvoiceById(id: number): Invoice | null {
  return db.select().from(invoices).where(eq(invoices.id, id)).get() ?? null;
}

export function getInvoiceByNumber(number: string): Invoice | null {
  return (
    db.select().from(invoices).where(eq(invoices.number, number)).get() ?? null
  );
}

export function listItems(invoiceId: number): InvoiceItem[] {
  return db
    .select()
    .from(invoiceItems)
    .where(eq(invoiceItems.invoiceId, invoiceId))
    .orderBy(asc(invoiceItems.position), asc(invoiceItems.id))
    .all();
}

export function getItemById(id: number): InvoiceItem | null {
  return (
    db.select().from(invoiceItems).where(eq(invoiceItems.id, id)).get() ?? null
  );
}

export function getClientById(id: number): Client | null {
  return db.select().from(clients).where(eq(clients.id, id)).get() ?? null;
}

/** Sum of item values (minor units) for an invoice. */
export function invoiceTotal(invoiceId: number): number {
  const row = db
    .select({ total: sql<number>`coalesce(sum(${invoiceItems.value}), 0)` })
    .from(invoiceItems)
    .where(eq(invoiceItems.invoiceId, invoiceId))
    .get();
  return row?.total ?? 0;
}

/** Highest current item position for an invoice, or -1 when empty. */
function maxItemPosition(invoiceId: number): number {
  const row = db
    .select({ max: sql<number | null>`max(${invoiceItems.position})` })
    .from(invoiceItems)
    .where(eq(invoiceItems.invoiceId, invoiceId))
    .get();
  return row?.max ?? -1;
}

export type ItemInput = {
  name: string;
  value: number;
  source: string;
  notes: string | null;
};

export function insertItem(invoiceId: number, input: ItemInput): InvoiceItem {
  const now = nowIso();
  return db
    .insert(invoiceItems)
    .values({
      invoiceId,
      name: input.name,
      value: input.value,
      source: input.source,
      notes: input.notes,
      position: maxItemPosition(invoiceId) + 1,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
}

export function updateItem(id: number, input: ItemInput): InvoiceItem {
  return db
    .update(invoiceItems)
    .set({
      name: input.name,
      value: input.value,
      source: input.source,
      notes: input.notes,
      updatedAt: nowIso(),
    })
    .where(eq(invoiceItems.id, id))
    .returning()
    .get();
}

export function deleteItem(id: number): void {
  db.delete(invoiceItems).where(eq(invoiceItems.id, id)).run();
}

export function updateInvoiceStatus(id: number, status: string): Invoice {
  return db
    .update(invoices)
    .set({ status, updatedAt: nowIso() })
    .where(eq(invoices.id, id))
    .returning()
    .get();
}

export function updateInvoiceNfse(id: number, text: string | null): Invoice {
  return db
    .update(invoices)
    .set({ nfseDescription: text, updatedAt: nowIso() })
    .where(eq(invoices.id, id))
    .returning()
    .get();
}

export function updateInvoiceArchivedPdf(
  id: number,
  fileId: number,
): Invoice {
  return db
    .update(invoices)
    .set({ archivedPdfFileId: fileId, updatedAt: nowIso() })
    .where(eq(invoices.id, id))
    .returning()
    .get();
}

export function getFileById(id: number): FileRecord | null {
  return db.select().from(files).where(eq(files.id, id)).get() ?? null;
}

export function getNotaFiscalLink(invoiceId: number): NotaFiscalLink | null {
  return (
    db
      .select()
      .from(notaFiscalLinks)
      .where(eq(notaFiscalLinks.invoiceId, invoiceId))
      .get() ?? null
  );
}

export type NotaFiscalLinkInput = {
  nfNumber: string | null;
  issueDate: string | null;
  verificationCode: string | null;
  publicUrl: string | null;
  notes: string | null;
  /** undefined leaves the existing attachment untouched; a number replaces it. */
  pdfFileId?: number;
  xmlFileId?: number;
};

/** Create or update the single nota fiscal link for an invoice (spec §16). */
export function upsertNotaFiscalLink(
  invoiceId: number,
  input: NotaFiscalLinkInput,
): NotaFiscalLink {
  const now = nowIso();
  const existing = getNotaFiscalLink(invoiceId);
  if (existing) {
    return db
      .update(notaFiscalLinks)
      .set({
        nfNumber: input.nfNumber,
        issueDate: input.issueDate,
        verificationCode: input.verificationCode,
        publicUrl: input.publicUrl,
        notes: input.notes,
        ...(input.pdfFileId !== undefined ? { pdfFileId: input.pdfFileId } : {}),
        ...(input.xmlFileId !== undefined ? { xmlFileId: input.xmlFileId } : {}),
        updatedAt: now,
      })
      .where(eq(notaFiscalLinks.id, existing.id))
      .returning()
      .get();
  }
  return db
    .insert(notaFiscalLinks)
    .values({
      invoiceId,
      nfNumber: input.nfNumber,
      issueDate: input.issueDate,
      verificationCode: input.verificationCode,
      publicUrl: input.publicUrl,
      notes: input.notes,
      pdfFileId: input.pdfFileId ?? null,
      xmlFileId: input.xmlFileId ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
}

export type CreateInvoiceRow = Omit<
  NewInvoice,
  "id" | "createdAt" | "updatedAt"
>;

/**
 * Allocate the next sequence value for (client, profile, period) and create the
 * invoice with its initial items in one transaction. The numbering pattern is
 * rendered by the caller via `numberFor`, which receives the freshly allocated
 * sequence so the stored number and the sequence stay consistent (spec §11).
 *
 * Throws if the resulting number collides with an existing invoice — the UNIQUE
 * indexes are the final guard; this surfaces as a thrown SQLite error.
 */
export function allocateAndCreateInvoice(args: {
  clientId: number;
  numberingProfileId: number;
  periodKey: string;
  numberFor: (seq: number) => string;
  invoice: Omit<CreateInvoiceRow, "number" | "numberingProfileId" | "clientId">;
  /** Built after the number is known so item templates can use it. */
  buildItems: (
    number: string,
  ) => Array<Omit<NewInvoiceItem, "id" | "invoiceId" | "createdAt" | "updatedAt">>;
}): Invoice {
  return db.transaction((tx) => {
    const now = nowIso();
    const existing = tx
      .select()
      .from(invoiceSequences)
      .where(
        and(
          eq(invoiceSequences.clientId, args.clientId),
          eq(invoiceSequences.numberingProfileId, args.numberingProfileId),
          eq(invoiceSequences.periodKey, args.periodKey),
        ),
      )
      .get();

    const seq = existing?.nextSeq ?? 1;

    if (existing) {
      tx.update(invoiceSequences)
        .set({ nextSeq: seq + 1, updatedAt: now })
        .where(eq(invoiceSequences.id, existing.id))
        .run();
    } else {
      tx.insert(invoiceSequences)
        .values({
          clientId: args.clientId,
          numberingProfileId: args.numberingProfileId,
          periodKey: args.periodKey,
          nextSeq: seq + 1,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }

    const number = args.numberFor(seq);
    const invoice = tx
      .insert(invoices)
      .values({
        ...args.invoice,
        clientId: args.clientId,
        numberingProfileId: args.numberingProfileId,
        number,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();

    insertItemsTx(tx, invoice.id, args.buildItems(number), now);
    return invoice;
  });
}

/**
 * Create a manually-numbered invoice (no profile / no sequence allocation) with
 * its initial items, transactionally. The UNIQUE index enforces no collision.
 */
export function createManualInvoice(args: {
  invoice: CreateInvoiceRow;
  items: Array<Omit<NewInvoiceItem, "id" | "invoiceId" | "createdAt" | "updatedAt">>;
}): Invoice {
  return db.transaction((tx) => {
    const now = nowIso();
    const invoice = tx
      .insert(invoices)
      .values({ ...args.invoice, createdAt: now, updatedAt: now })
      .returning()
      .get();
    insertItemsTx(tx, invoice.id, args.items, now);
    return invoice;
  });
}

function insertItemsTx(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  invoiceId: number,
  items: Array<Omit<NewInvoiceItem, "id" | "invoiceId" | "createdAt" | "updatedAt">>,
  now: string,
): void {
  items.forEach((item, position) => {
    tx.insert(invoiceItems)
      .values({
        ...item,
        invoiceId,
        position,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  });
}
