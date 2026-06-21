import type { Client, NewClient, NumberingProfile } from "../../db/schema.ts";
import { nowIso } from "../../domain/dates.ts";
import { parseMoneyToMinor } from "../../domain/money.ts";
import * as repo from "./clients.repository.ts";
import type { ClientFormInput } from "./clients.schema.ts";

/** Raised when a client code collides with an existing client. */
export class ClientCodeTakenError extends Error {
  constructor(public code: string) {
    super(`Client code "${code}" is already in use`);
    this.name = "ClientCodeTakenError";
  }
}

export function listClients(): Client[] {
  return repo.listClients();
}

export function getClient(id: number): Client | null {
  return repo.getClientById(id);
}

export function listNumberingProfiles(): NumberingProfile[] {
  return repo.listNumberingProfiles();
}

/** Map validated form input to the persistable column shape. */
function toColumns(input: ClientFormInput): Omit<
  NewClient,
  "id" | "createdAt" | "updatedAt"
> {
  const monthlyValue =
    input.defaultFixedMonthlyValue !== undefined
      ? parseMoneyToMinor(input.defaultFixedMonthlyValue, input.defaultCurrency)
      : null;

  return {
    name: input.name,
    legalName: input.legalName ?? null,
    code: input.code,
    address: input.address ?? null,
    country: input.country ?? null,
    email: input.email ?? null,
    defaultCurrency: input.defaultCurrency,
    defaultFixedMonthlyValue: monthlyValue,
    defaultFixedMonthlyItemNameTemplate:
      input.defaultFixedMonthlyItemNameTemplate ?? null,
    defaultNfseDescriptionTemplate: input.defaultNfseDescriptionTemplate ?? null,
    defaultPdfFilenameTemplate: input.defaultPdfFilenameTemplate ?? null,
    numberingProfileId: input.numberingProfileId ?? null,
  };
}

export function createClient(input: ClientFormInput): Client {
  if (repo.getClientByCode(input.code)) {
    throw new ClientCodeTakenError(input.code);
  }
  const now = nowIso();
  return repo.insertClient({ ...toColumns(input), createdAt: now, updatedAt: now });
}

export function updateClient(id: number, input: ClientFormInput): Client {
  const existing = repo.getClientByCode(input.code);
  if (existing && existing.id !== id) {
    throw new ClientCodeTakenError(input.code);
  }
  return repo.updateClientRow(id, { ...toColumns(input), updatedAt: nowIso() });
}
