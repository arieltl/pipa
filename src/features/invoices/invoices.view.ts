import type { InvoiceItem } from "../../db/schema.ts";
import { todayDate } from "../../domain/dates.ts";
import { minorToDecimalString } from "../../domain/money.ts";
import { formString, str, type FormBody } from "../../web/form-values.ts";
import type { InvoiceFormValues } from "./components/invoice-composer.tsx";
import type { ItemDraft } from "./invoices.service.ts";
import type { ItemFormValues } from "./components/items-section.tsx";

export function emptyInvoiceFormValues(
  defaultCurrency = "GBP",
): InvoiceFormValues {
  return {
    clientId: "",
    invoiceDate: todayDate(),
    currency: defaultCurrency,
    manualNumber: "",
    notes: "",
    items: [],
  };
}

export function invoiceFormValuesFromBody(body: FormBody): InvoiceFormValues {
  return {
    clientId: formString(body.clientId),
    invoiceDate: formString(body.invoiceDate) || todayDate(),
    currency: formString(body.currency) || "GBP",
    manualNumber: formString(body.manualNumber),
    notes: formString(body.notes),
    items: parseItemDrafts(body.items),
  };
}

/** Parse the form's `items` JSON blob back into draft rows for re-rendering. */
function parseItemDrafts(raw: FormBody[string] | undefined): ItemDraft[] {
  if (typeof raw !== "string" || raw.trim() === "") return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((it) => ({
      name: str(it?.name),
      value: str(it?.value),
      source: str(it?.source) || "other",
      notes: str(it?.notes),
    }));
  } catch {
    return [];
  }
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
