import { z } from "zod";
import { SUPPORTED_CURRENCIES } from "../../domain/money.ts";
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
const warningAck = z.preprocess((v) => v === "on" || v === "true", z.boolean());
const defaultPdfTemplateId = z.preprocess(
  (v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : undefined),
  z.number().int().positive().optional(),
);

/** Validated issuer settings form input. */
export const issuerFormSchema = z
  .object({
    name: requiredText("Issuer name", 200),
    defaultCurrency: z.enum(SUPPORTED_CURRENCIES),
    defaultPdfFilenameTemplate: optionalText(300),
    defaultPdfTemplateId,
    partyFields,
    acknowledgePartyWarnings: warningAck.optional(),
  })
  .superRefine((data, ctx) => {
    if (data.partyFields) {
      try {
        const warnings = validatePartyFieldValues(data.partyFields);
        if (warnings.length && !data.acknowledgePartyWarnings) ctx.addIssue({ code: "custom", path: ["partyFields"], message: `${warnings.map((w) => w.message).join("; ")}. Check “save anyway” to keep these exact values.` });
      } catch (error) { ctx.addIssue({ code: "custom", path: ["partyFields"], message: error instanceof Error ? error.message : "Invalid document field" }); }
    }
    const message = templateFieldError(data.defaultPdfFilenameTemplate);
    if (message) {
      ctx.addIssue({
        code: "custom",
        path: ["defaultPdfFilenameTemplate"],
        message,
      });
    }
  });

export type IssuerFormInput = z.infer<typeof issuerFormSchema>;
