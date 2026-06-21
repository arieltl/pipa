import { asc, eq } from "drizzle-orm";
import { db } from "../../db/client.ts";
import {
  clients,
  numberingProfiles,
  type Client,
  type NewClient,
  type NumberingProfile,
} from "../../db/schema.ts";

export function listClients(): Client[] {
  return db.select().from(clients).orderBy(asc(clients.name)).all();
}

export function getClientById(id: number): Client | null {
  return db.select().from(clients).where(eq(clients.id, id)).get() ?? null;
}

export function getClientByCode(code: string): Client | null {
  return db.select().from(clients).where(eq(clients.code, code)).get() ?? null;
}

export function getDefaultClient(): Client | null {
  return db.select().from(clients).where(eq(clients.isDefault, true)).get() ?? null;
}

/** Pin one client as the default, clearing the flag on every other client. */
export function setDefaultClient(id: number): void {
  db.transaction((tx) => {
    tx.update(clients).set({ isDefault: false }).run();
    tx.update(clients).set({ isDefault: true }).where(eq(clients.id, id)).run();
  });
}

export function insertClient(values: NewClient): Client {
  return db.insert(clients).values(values).returning().get();
}

export function updateClientRow(
  id: number,
  values: Partial<NewClient>,
): Client {
  return db
    .update(clients)
    .set(values)
    .where(eq(clients.id, id))
    .returning()
    .get();
}

export function listNumberingProfiles(): NumberingProfile[] {
  return db
    .select()
    .from(numberingProfiles)
    .orderBy(asc(numberingProfiles.name))
    .all();
}
