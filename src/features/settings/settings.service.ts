import type { IssuerSettings } from "../../db/schema.ts";
import * as repo from "./settings.repository.ts";
import type { IssuerFormInput } from "./settings.schema.ts";
import { validateDefaultTemplate } from "../pdf-templates/pdf-templates.service.ts";

export function loadIssuerSettings(): IssuerSettings | null {
  return repo.getIssuerSettings();
}

export function updateIssuerSettings(input: IssuerFormInput): IssuerSettings {
  validateDefaultTemplate(input.defaultPdfTemplateId);
  return repo.saveIssuerSettings(input);
}
