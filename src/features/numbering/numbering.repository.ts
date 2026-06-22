import { and, asc, eq } from "drizzle-orm";
import { db } from "../../db/client.ts";
import {
  invoiceSequences,
  numberingProfiles,
  type InvoiceSequence,
  type NewNumberingProfile,
  type NumberingProfile,
} from "../../db/schema.ts";
import { nowIso } from "../../domain/dates.ts";

export function listProfiles(): NumberingProfile[] {
  return db
    .select()
    .from(numberingProfiles)
    .orderBy(asc(numberingProfiles.name))
    .all();
}

export function getProfile(id: number): NumberingProfile | null {
  return (
    db.select().from(numberingProfiles).where(eq(numberingProfiles.id, id)).get() ??
    null
  );
}

export function insertProfile(values: NewNumberingProfile): NumberingProfile {
  return db.insert(numberingProfiles).values(values).returning().get();
}

export function updateProfile(
  id: number,
  values: Partial<NewNumberingProfile>,
): NumberingProfile {
  return db
    .update(numberingProfiles)
    .set(values)
    .where(eq(numberingProfiles.id, id))
    .returning()
    .get();
}

export function getSequence(args: {
  clientId: number;
  numberingProfileId: number;
  periodKey: string;
}): InvoiceSequence | null {
  return (
    db
      .select()
      .from(invoiceSequences)
      .where(
        and(
          eq(invoiceSequences.clientId, args.clientId),
          eq(invoiceSequences.numberingProfileId, args.numberingProfileId),
          eq(invoiceSequences.periodKey, args.periodKey),
        ),
      )
      .get() ?? null
  );
}

export function setNextSequence(args: {
  clientId: number;
  numberingProfileId: number;
  periodKey: string;
  nextSeq: number;
}): InvoiceSequence {
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

    if (existing) {
      return tx
        .update(invoiceSequences)
        .set({ nextSeq: args.nextSeq, updatedAt: now })
        .where(eq(invoiceSequences.id, existing.id))
        .returning()
        .get();
    }

    return tx
      .insert(invoiceSequences)
      .values({
        clientId: args.clientId,
        numberingProfileId: args.numberingProfileId,
        periodKey: args.periodKey,
        nextSeq: args.nextSeq,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
  });
}
