import type { InvoiceItem } from "../../db/schema.ts";
import { todayDate } from "../../domain/dates.ts";
import { minorToDecimalString } from "../../domain/money.ts";
import { formString, str, type FormBody } from "../../web/form-values.ts";
import type { InvoiceFormValues } from "./components/invoice-form.tsx";
import type { ItemFormValues } from "./components/items-section.tsx";

export function emptyInvoiceFormValues(
  defaultCurrency = "GBP",
): InvoiceFormValues {
  return {
    clientId: "",
    invoiceDate: todayDate(),
    currency: defaultCurrency,
    includeFixedMonthly: true,
    manualNumber: "",
    notes: "",
  };
}

export function invoiceFormValuesFromBody(body: FormBody): InvoiceFormValues {
  return {
    clientId: formString(body.clientId),
    invoiceDate: formString(body.invoiceDate) || todayDate(),
    currency: formString(body.currency) || "GBP",
    includeFixedMonthly: body.includeFixedMonthly === "on",
    manualNumber: formString(body.manualNumber),
    notes: formString(body.notes),
  };
}

export function emptyItemFormValues(): ItemFormValues {
  return { name: "", value: "", source: "other", notes: "" };
}

export function itemFormValuesFromBody(body: FormBody): ItemFormValues {
  return {
    name: formString(body.name),
    value: formString(body.value),
    source: formString(body.source) || "other",
    notes: formString(body.notes),
  };
}

export function itemFormValuesFromRow(
  item: InvoiceItem,
  currency: string,
): ItemFormValues {
  return {
    name: item.name,
    value: minorToDecimalString(item.value, currency),
    source: item.source,
    notes: str(item.notes),
  };
}
