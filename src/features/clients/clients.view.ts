import type { Client } from "../../db/schema.ts";
import { minorToDecimalString } from "../../domain/money.ts";
import { formString, str, type FormBody } from "../../web/form-values.ts";
import type { ClientFormValues } from "./components/client-form.tsx";

export function emptyClientFormValues(
  defaultCurrency = "GBP",
): ClientFormValues {
  return {
    name: "",
    legalName: "",
    code: "",
    address: "",
    country: "",
    email: "",
    defaultCurrency,
    defaultFixedMonthlyValue: "",
    defaultFixedMonthlyItemNameTemplate: "",
    defaultNfseDescriptionTemplate: "",
    defaultPdfFilenameTemplate: "",
    numberingProfileId: "",
    isDefault: false,
  };
}

export function clientFormValuesFromRow(client: Client): ClientFormValues {
  return {
    name: client.name,
    legalName: str(client.legalName),
    code: client.code,
    address: str(client.address),
    country: str(client.country),
    email: str(client.email),
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
    defaultNfseDescriptionTemplate: str(client.defaultNfseDescriptionTemplate),
    defaultPdfFilenameTemplate: str(client.defaultPdfFilenameTemplate),
    numberingProfileId:
      client.numberingProfileId != null
        ? String(client.numberingProfileId)
        : "",
    isDefault: client.isDefault,
  };
}

export function clientFormValuesFromBody(body: FormBody): ClientFormValues {
  return {
    name: formString(body.name),
    legalName: formString(body.legalName),
    code: formString(body.code),
    address: formString(body.address),
    country: formString(body.country),
    email: formString(body.email),
    defaultCurrency: formString(body.defaultCurrency) || "GBP",
    defaultFixedMonthlyValue: formString(body.defaultFixedMonthlyValue),
    defaultFixedMonthlyItemNameTemplate: formString(
      body.defaultFixedMonthlyItemNameTemplate,
    ),
    defaultNfseDescriptionTemplate: formString(
      body.defaultNfseDescriptionTemplate,
    ),
    defaultPdfFilenameTemplate: formString(body.defaultPdfFilenameTemplate),
    numberingProfileId: formString(body.numberingProfileId),
    isDefault: body.isDefault === "on" || body.isDefault === "true",
  };
}
