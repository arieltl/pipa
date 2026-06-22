import type {
  Client,
  InvoiceSequence,
  NewNumberingProfile,
  NumberingProfile,
} from "../../db/schema.ts";
import {
  hasSequenceToken,
  isResetPeriod,
  periodKeyFor,
  renderNumberPattern,
  type ResetPeriod,
} from "../../domain/numbering.ts";
import { todayDate, nowIso } from "../../domain/dates.ts";
import type {
  NumberingProfileFormInput,
  SequenceFormInput,
} from "./numbering.schema.ts";
import * as repo from "./numbering.repository.ts";

export type NumberingPreview = {
  periodKey: string;
  nextSeq: number;
  number: string;
  hasSequence: boolean;
  profile: NumberingProfile;
};

export function listProfiles(): NumberingProfile[] {
  return repo.listProfiles();
}

export function getProfile(id: number): NumberingProfile | null {
  return repo.getProfile(id);
}

export function createProfile(input: NumberingProfileFormInput): NumberingProfile {
  const now = nowIso();
  return repo.insertProfile({
    ...profileColumns(input),
    createdAt: now,
    updatedAt: now,
  });
}

export function updateProfile(
  id: number,
  input: NumberingProfileFormInput,
): NumberingProfile {
  return repo.updateProfile(id, {
    ...profileColumns(input),
    updatedAt: nowIso(),
  });
}

function profileColumns(input: NumberingProfileFormInput): Omit<
  NewNumberingProfile,
  "id" | "createdAt" | "updatedAt"
> {
  return {
    name: input.name,
    pattern: input.pattern,
    resetPeriod: input.resetPeriod,
  };
}

export function profileResetPeriod(profile: NumberingProfile): ResetPeriod {
  return isResetPeriod(profile.resetPeriod) ? profile.resetPeriod : "monthly";
}

export function previewForClient(
  client: Client,
  profile: NumberingProfile,
  invoiceDate = todayDate(),
  seq?: number,
): NumberingPreview {
  const periodKey = periodKeyFor(profileResetPeriod(profile), invoiceDate);
  const current = repo.getSequence({
    clientId: client.id,
    numberingProfileId: profile.id,
    periodKey,
  });
  const nextSeq = seq ?? current?.nextSeq ?? 1;
  return {
    periodKey,
    nextSeq,
    number: renderNumberPattern(profile.pattern, {
      clientCode: client.code,
      invoiceDate,
      seq: nextSeq,
    }),
    hasSequence: hasSequenceToken(profile.pattern),
    profile,
  };
}

export function sequenceForClient(
  client: Client,
  profile: NumberingProfile,
  invoiceDate = todayDate(),
): InvoiceSequence | null {
  return repo.getSequence({
    clientId: client.id,
    numberingProfileId: profile.id,
    periodKey: periodKeyFor(profileResetPeriod(profile), invoiceDate),
  });
}

export function setClientNextSequence(
  client: Client,
  profile: NumberingProfile,
  invoiceDate: string,
  input: SequenceFormInput,
): InvoiceSequence {
  return repo.setNextSequence({
    clientId: client.id,
    numberingProfileId: profile.id,
    periodKey: periodKeyFor(profileResetPeriod(profile), invoiceDate),
    nextSeq: input.nextSeq,
  });
}
