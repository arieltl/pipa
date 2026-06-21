import { z } from "zod";
import { parseMoneyToMinor, SUPPORTED_CURRENCIES } from "../../domain/money.ts";
import {
  optionalEmail,
  optionalText,
  requiredText,
} from "../../web/form-schema.ts";

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

export const clientFormSchema = z
  .object({
    name: requiredText("Name", 200),
    legalName: optionalText(200),
    code: clientCode,
    address: optionalText(1000),
    country: optionalText(100),
    email: optionalEmail(),
    defaultCurrency: z.enum(SUPPORTED_CURRENCIES),
    defaultFixedMonthlyValue: optionalText(30),
    defaultFixedMonthlyItemNameTemplate: optionalText(500),
    defaultNfseDescriptionTemplate: optionalText(2000),
    defaultPdfFilenameTemplate: optionalText(300),
    numberingProfileId,
  })
  .superRefine((data, ctx) => {
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
  });

export type ClientFormInput = z.infer<typeof clientFormSchema>;
