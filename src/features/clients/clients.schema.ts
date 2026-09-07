import { z } from "zod";
import { parseMoneyToMinor, SUPPORTED_CURRENCIES } from "../../domain/money.ts";
import { templateFieldError } from "../invoices/invoice-template-context.ts";
import {
  optionalText,
  requiredText,
} from "../../web/form-schema.ts";
import { partyFieldsSchema, validatePartyFieldValues } from "../../domain/party-fields/index.ts";

const partyFields = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return value; }
}, partyFieldsSchema).optional();

/** Client code: uppercased, used in invoice numbers / filenames / templates. */
const clientCode = z.preprocess(
  (v) => (typeof v === "string" ? v.trim().toUpperCase() : v),
  z
    .string({ message: "Code is required" })
    .min(1, "Code is required")
    .max(30, "Code is too long")
    .regex(/^[A-Z0-9_-]+$/, "Use letters, numbers, dashes or underscores"),
);

const numberingProfileId = z.preprocess(
  (v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : undefined),
  z.number().int().positive().optional(),
);
const defaultPdfTemplateId = z.preprocess(
  (v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : undefined),
  z.number().int().positive().optional(),
);

/** htmx checkboxes submit "on" when checked and are absent otherwise. */
const checkbox = z.preprocess((v) => v === "on" || v === "true", z.boolean());

export const clientFormSchema = z
  .object({
    name: requiredText("Name", 200),
    code: clientCode,
    defaultCurrency: z.enum(SUPPORTED_CURRENCIES),
    defaultFixedMonthlyValue: optionalText(30),
    defaultFixedMonthlyItemNameTemplate: optionalText(500),
    defaultPdfFilenameTemplate: optionalText(300),
    numberingProfileId,
    defaultPdfTemplateId,
    isDefault: checkbox,
    partyFields,
    acknowledgePartyWarnings: checkbox.optional(),
  })
  .superRefine((data, ctx) => {
    if (data.partyFields) {
      try {
        const warnings = validatePartyFieldValues(data.partyFields);
        if (warnings.length && !data.acknowledgePartyWarnings) ctx.addIssue({ code: "custom", path: ["partyFields"], message: `${warnings.map((w) => w.message).join("; ")}. Check “save anyway” to keep these exact values.` });
      } catch (error) { ctx.addIssue({ code: "custom", path: ["partyFields"], message: error instanceof Error ? error.message : "Invalid document field" }); }
    }
    if (
      data.defaultFixedMonthlyValue !== undefined &&
      parseMoneyToMinor(data.defaultFixedMonthlyValue, data.defaultCurrency) ===
        null
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["defaultFixedMonthlyValue"],
        message: "Enter a valid amount, e.g. 4000.00",
      });
    }

    const templateFields = [
      "defaultFixedMonthlyItemNameTemplate",
      "defaultPdfFilenameTemplate",
    ] as const;
    for (const field of templateFields) {
      const message = templateFieldError(data[field]);
      if (message) ctx.addIssue({ code: "custom", path: [field], message });
    }
  });

export type ClientFormInput = z.infer<typeof clientFormSchema>;
