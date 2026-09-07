import type { IssuerSettings } from "../../db/schema.ts";
import { formString, str, type FormBody } from "../../web/form-values.ts";
import type { IssuerFormValues } from "./components/issuer-form.tsx";
import { applyFieldSet, parsePartyFields, type PartyField } from "../../domain/party-fields/index.ts";

function fieldsFrom(value: string | undefined): PartyField[] {
  if (!value) return applyFieldSet([], "generic_business");
  try { return parsePartyFields(value); } catch { return []; }
}

/** DB row (or empty) to form values for rendering the issuer form. */
export function issuerFormValuesFromRow(
  row: IssuerSettings | null,
): IssuerFormValues {
  return {
    name: str(row?.name),
    defaultCurrency: row?.defaultCurrency ?? "GBP",
    defaultPdfFilenameTemplate: str(row?.defaultPdfFilenameTemplate),
    defaultPdfTemplateId:
      row?.defaultPdfTemplateId != null ? String(row.defaultPdfTemplateId) : "",
    partyFields: fieldsFrom(row?.partyFieldsJson),
  };
}

/** Raw submitted body to form values, for re-rendering after a 422. */
export function issuerFormValuesFromBody(body: FormBody): IssuerFormValues {
  return {
    name: formString(body.name),
    defaultCurrency: formString(body.defaultCurrency) || "GBP",
    defaultPdfFilenameTemplate: formString(body.defaultPdfFilenameTemplate),
    defaultPdfTemplateId: formString(body.defaultPdfTemplateId),
    partyFields: fieldsFrom(formString(body.partyFields)),
  };
}
