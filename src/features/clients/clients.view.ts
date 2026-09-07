import type { Client } from "../../db/schema.ts";
import { minorToDecimalString } from "../../domain/money.ts";
import { formString, str, type FormBody } from "../../web/form-values.ts";
import type { ClientFormValues } from "./components/client-form.tsx";
import { applyFieldSet, parsePartyFields, type PartyField } from "../../domain/party-fields/index.ts";

function fieldsFrom(value: string | undefined, emptyDefault = false): PartyField[] {
  if (!value) return emptyDefault ? applyFieldSet([], "minimal_customer") : [];
  try { return parsePartyFields(value); } catch { return []; }
}

export function emptyClientFormValues(
  defaultCurrency = "GBP",
): ClientFormValues {
  return {
    name: "",
    code: "",
    defaultCurrency,
    defaultFixedMonthlyValue: "",
    defaultFixedMonthlyItemNameTemplate: "",
    defaultPdfFilenameTemplate: "",
    numberingProfileId: "",
    defaultPdfTemplateId: "",
    isDefault: false,
    partyFields: fieldsFrom(undefined, true),
  };
}

export function clientFormValuesFromRow(client: Client): ClientFormValues {
  return {
    name: client.name,
    code: client.code,
    defaultCurrency: client.defaultCurrency,
    defaultFixedMonthlyValue:
      client.defaultFixedMonthlyValue != null
        ? minorToDecimalString(
            client.defaultFixedMonthlyValue,
            client.defaultCurrency,
          )
        : "",
    defaultFixedMonthlyItemNameTemplate: str(
      client.defaultFixedMonthlyItemNameTemplate,
    ),
    defaultPdfFilenameTemplate: str(client.defaultPdfFilenameTemplate),
    numberingProfileId:
      client.numberingProfileId != null
        ? String(client.numberingProfileId)
        : "",
    defaultPdfTemplateId:
      client.defaultPdfTemplateId != null
        ? String(client.defaultPdfTemplateId)
        : "",
    isDefault: client.isDefault,
    partyFields: fieldsFrom(client.partyFieldsJson),
  };
}

export function clientFormValuesFromBody(body: FormBody): ClientFormValues {
  return {
    name: formString(body.name),
    code: formString(body.code),
    defaultCurrency: formString(body.defaultCurrency) || "GBP",
    defaultFixedMonthlyValue: formString(body.defaultFixedMonthlyValue),
    defaultFixedMonthlyItemNameTemplate: formString(
      body.defaultFixedMonthlyItemNameTemplate,
    ),
    defaultPdfFilenameTemplate: formString(body.defaultPdfFilenameTemplate),
    numberingProfileId: formString(body.numberingProfileId),
    defaultPdfTemplateId: formString(body.defaultPdfTemplateId),
    isDefault: body.isDefault === "on" || body.isDefault === "true",
    partyFields: fieldsFrom(formString(body.partyFields)),
  };
}
