import type { IssuerSettings } from "../../db/schema.ts";
import * as repo from "./settings.repository.ts";
import type { IssuerFormInput } from "./settings.schema.ts";

export function loadIssuerSettings(): IssuerSettings | null {
  return repo.getIssuerSettings();
}

export function updateIssuerSettings(input: IssuerFormInput): IssuerSettings {
  return repo.saveIssuerSettings(input);
}
