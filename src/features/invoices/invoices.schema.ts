import { z } from "zod";
import { isValidDateString } from "../../domain/dates.ts";
import { parseMoneyToMinor, SUPPORTED_CURRENCIES } from "../../domain/money.ts";
import { optionalText, requiredText } from "../../web/form-schema.ts";
import { INVOICE_STATUSES } from "../../domain/invoice-status.ts";

/** Checkbox value → boolean: HTML sends "on"/"true" when checked, nothing otherwise. */
const checkbox = z.preprocess(
  (v) => v === "on" || v === "true" || v === true,
  z.boolean(),
);

const idField = z.preprocess(
  (v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : undefined),
  z.number({ message: "Select a client" }).int().positive(),
);

const invoiceDate = z
  .string({ message: "Invoice date is required" })
  .trim()
  .refine(isValidDateString, "Enter a valid date");

/** Optional manual invoice number; uppercased, blank becomes undefined. */
const manualNumber = z.preprocess(
  (v) =>
    typeof v === "string" && v.trim() !== "" ? v.trim().toUpperCase() : undefined,
  z.string().max(60, "Number is too long").optional(),
);

const numberingMode = z
  .enum(["auto", "sequence", "manual"])
  .default("auto");

const sequenceOverride = z.preprocess(
  (v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : undefined),
  z.number().int().positive().optional(),
);

export const ITEM_SOURCES = ["fixed_monthly", "expense", "other"] as const;
export type ItemSource = (typeof ITEM_SOURCES)[number];

/** A line item drafted in the create form, before the invoice exists. */
const itemDraftSchema = z.object({
  name: requiredText("Item name", 300),
  value: requiredText("Value", 30),
  source: z.enum(ITEM_SOURCES).default("other"),
  notes: optionalText(1000),
});

/** Items arrive as a JSON string from the form's hidden field. */
const itemsField = z.preprocess((v) => {
  if (Array.isArray(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    try {
      return JSON.parse(v);
    } catch {
      return [];
    }
  }
  return [];
}, z.array(itemDraftSchema).max(50, "Too many items"));

export const createInvoiceSchema = z
  .object({
    clientId: idField,
    invoiceDate,
    currency: z.enum(SUPPORTED_CURRENCIES),
    numberingMode,
    manualNumber,
    sequenceOverride,
    advanceSequence: checkbox.default(true),
    notes: optionalText(2000),
    items: itemsField,
  })
  .superRefine((data, ctx) => {
    if (data.numberingMode === "manual" && data.manualNumber === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["manualNumber"],
        message: "Enter an invoice number",
      });
    }
    if (data.numberingMode === "sequence" && data.sequenceOverride === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["sequenceOverride"],
        message: "Enter a sequence number",
      });
    }
    data.items.forEach((item, i) => {
      if (parseMoneyToMinor(item.value, data.currency) === null) {
        ctx.addIssue({
          code: "custom",
          path: ["items", i, "value"],
          message: "Enter a valid amount, e.g. 120.00",
        });
      }
    });
  });

type CreateInvoiceFormOutput = z.infer<typeof createInvoiceSchema>;

export type CreateInvoiceInput = Omit<
  CreateInvoiceFormOutput,
  "numberingMode" | "advanceSequence"
> &
  Partial<Pick<CreateInvoiceFormOutput, "numberingMode" | "advanceSequence">>;

export const itemFormSchema = z
  .object({
    name: requiredText("Item name", 300),
    value: requiredText("Value", 30),
    source: z.enum(ITEM_SOURCES).default("other"),
    /** Currency the value is entered in; carried from the invoice. */
    currency: z.enum(SUPPORTED_CURRENCIES),
  })
  .superRefine((data, ctx) => {
    if (parseMoneyToMinor(data.value, data.currency) === null) {
      ctx.addIssue({
        code: "custom",
        path: ["value"],
        message: "Enter a valid amount, e.g. 120.00",
      });
    }
  });

export type ItemFormInput = z.infer<typeof itemFormSchema>;

/** Required invoice number; trimmed, uppercased, never blank. */
const requiredNumber = z.preprocess(
  (v) => (typeof v === "string" ? v.trim().toUpperCase() : v),
  z
    .string({ message: "Enter an invoice number" })
    .min(1, "Enter an invoice number")
    .max(60, "Number is too long"),
);

/** Edit a draft invoice's identity fields (number + date shown on the PDF). */
export const editInvoiceDocSchema = z.object({
  number: requiredNumber,
  invoiceDate,
});

export type EditInvoiceDocInput = z.infer<typeof editInvoiceDocSchema>;

export const statusSchema = z.object({ status: z.enum(INVOICE_STATUSES) });

/** Invoice notes — editable after creation, in any status. */
export const notesSchema = z.object({ notes: optionalText(2000) });

/** Optional `YYYY-MM-DD`; blank becomes undefined, otherwise must be valid. */
const optionalDate = z.preprocess(
  (v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined),
  z.string().refine(isValidDateString, "Enter a valid date").optional(),
);

/** Optional URL; blank becomes undefined, otherwise must be a valid URL. */
const optionalUrl = z.preprocess(
  (v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined),
  z.url("Enter a valid URL").max(2000).optional(),
);

/** Nota fiscal link metadata (spec §16); file uploads handled separately. */
export const notaFiscalLinkSchema = z.object({
  nfNumber: optionalText(120),
  issueDate: optionalDate,
  verificationCode: optionalText(200),
  publicUrl: optionalUrl,
  notes: optionalText(2000),
  /** When first linking from `issued`, advance the invoice to `sent`. */
  markSent: checkbox.default(false),
});

export type NotaFiscalLinkFormInput = z.infer<typeof notaFiscalLinkSchema>;
