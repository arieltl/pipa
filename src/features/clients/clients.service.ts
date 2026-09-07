import type { Client, NewClient, NumberingProfile } from "../../db/schema.ts";
import { nowIso } from "../../domain/dates.ts";
import { parseMoneyToMinor } from "../../domain/money.ts";
import * as repo from "./clients.repository.ts";
import type { ClientFormInput } from "./clients.schema.ts";
import { serializePartyFields } from "../../domain/party-fields/index.ts";
import { validateDefaultTemplate } from "../pdf-templates/pdf-templates.service.ts";

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

export function getDefaultClient(): Client | null {
  return repo.getDefaultClient();
}

export function setDefaultClient(id: number): void {
  repo.setDefaultClient(id);
}

export function listNumberingProfiles(): NumberingProfile[] {
  return repo.listNumberingProfiles();
}

/** Map validated form input to the persistable column shape. */
function toColumns(input: ClientFormInput, currentFields?: string): Omit<
  NewClient,
  "id" | "createdAt" | "updatedAt"
> {
  const monthlyValue =
    input.defaultFixedMonthlyValue !== undefined
      ? parseMoneyToMinor(input.defaultFixedMonthlyValue, input.defaultCurrency)
      : null;

  return {
    name: input.name,
    code: input.code,
    defaultCurrency: input.defaultCurrency,
    defaultFixedMonthlyValue: monthlyValue,
    defaultFixedMonthlyItemNameTemplate:
      input.defaultFixedMonthlyItemNameTemplate ?? null,
    defaultPdfFilenameTemplate: input.defaultPdfFilenameTemplate ?? null,
    numberingProfileId: input.numberingProfileId ?? null,
    defaultPdfTemplateId: input.defaultPdfTemplateId ?? null,
    isDefault: input.isDefault,
    partyFieldsJson: input.partyFields
      ? serializePartyFields(input.partyFields)
      : currentFields ?? "[]",
  };
}

export function createClient(input: ClientFormInput): Client {
  validateDefaultTemplate(input.defaultPdfTemplateId);
  if (repo.getClientByCode(input.code)) {
    throw new ClientCodeTakenError(input.code);
  }
  const now = nowIso();
  const client = repo.insertClient({
    ...toColumns(input),
    createdAt: now,
    updatedAt: now,
  });
  // Pinning a default must clear the flag on every other client.
  if (input.isDefault) repo.setDefaultClient(client.id);
  return client;
}

export function updateClient(id: number, input: ClientFormInput): Client {
  validateDefaultTemplate(input.defaultPdfTemplateId);
  const existing = repo.getClientByCode(input.code);
  if (existing && existing.id !== id) {
    throw new ClientCodeTakenError(input.code);
  }
  const client = repo.updateClientRow(id, {
    ...toColumns(input, repo.getClientById(id)?.partyFieldsJson),
    updatedAt: nowIso(),
  });
  if (input.isDefault) repo.setDefaultClient(id);
  return client;
}
