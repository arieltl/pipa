import type {
  Client,
  InvoiceItem,
  IssuerSettings,
} from "../../db/schema.ts";
import { formatDateBr, monthNameEn, monthNamePt } from "../../domain/dates.ts";
import { minorToDecimalString } from "../../domain/money.ts";
import {
  unknownTemplateVariables,
  type TemplateContext,
} from "../../domain/template-engine.ts";

/**
 * The full set of variable paths templates may reference (spec §13, §7). Used
 * both to build a render context and to validate templates in settings forms.
 */
export const TEMPLATE_VARIABLES = [
  "invoice.number",
  "invoice.date",
  "invoice.dateYear",
  "invoice.dateMonth",
  "invoice.dateMonthName",
  "invoice.dateMonthNamePt",
  "invoice.total",
  "invoice.currency",
  "client.name",
  "client.legalName",
  "client.country",
  "client.code",
  "issuer.name",
  "issuer.legalName",
  "items.summary",
] as const;

/**
 * Validation message for a template field that references variables outside
 * {@link TEMPLATE_VARIABLES}. Returns null when the field is blank or valid.
 * Used by settings/client forms to reject typos like `{{client.naem}}`.
 */
export function templateFieldError(
  value: string | null | undefined,
): string | null {
  if (!value || value.trim() === "") return null;
  const unknown = unknownTemplateVariables(value, TEMPLATE_VARIABLES);
  if (unknown.length === 0) return null;
  return `Unknown variable(s): ${unknown.map((v) => `{{${v}}}`).join(", ")}`;
}

export type InvoiceContextInput = {
  number: string;
  invoiceDate: string;
  currency: string;
  /** Total in minor units; pass the running total for nota fiscal text. */
  totalMinor: number;
  client: Client;
  issuer: IssuerSettings | null;
  items: Pick<InvoiceItem, "name" | "value">[];
};

/**
 * Build the flat `{{path}}` -> value map for an invoice. Formatting (dates,
 * money, month names) is precomputed here so templates never call helpers.
 */
export function buildInvoiceContext(
  input: InvoiceContextInput,
): TemplateContext {
  const [year = "", month = ""] = input.invoiceDate.split("-");
  return {
    "invoice.number": input.number,
    "invoice.date": formatDateBr(input.invoiceDate),
    "invoice.dateYear": year,
    "invoice.dateMonth": month,
    "invoice.dateMonthName": monthNameEn(input.invoiceDate),
    "invoice.dateMonthNamePt": monthNamePt(input.invoiceDate),
    "invoice.total": minorToDecimalString(input.totalMinor, input.currency),
    "invoice.currency": input.currency,
    "client.name": input.client.name,
    "client.legalName": input.client.legalName ?? "",
    "client.country": input.client.country ?? "",
    "client.code": input.client.code,
    "issuer.name": input.issuer?.name ?? "",
    "issuer.legalName": input.issuer?.legalName ?? "",
    "items.summary": input.items.map((i) => i.name).join("; "),
  };
}
