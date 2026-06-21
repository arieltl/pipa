import { z } from "zod";
import { SUPPORTED_CURRENCIES } from "../../domain/money.ts";
import { templateFieldError } from "../invoices/invoice-template-context.ts";
import {
  optionalEmail,
  optionalText,
  requiredText,
} from "../../web/form-schema.ts";

/** Validated issuer settings form input. */
export const issuerFormSchema = z
  .object({
    name: requiredText("Issuer name", 200),
    legalName: optionalText(200),
    cnpj: optionalText(40),
    address: optionalText(1000),
    email: optionalEmail(),
    bankBeneficiary: optionalText(200),
    bankBeneficiaryAddress: optionalText(1000),
    bankAccountNumber: optionalText(200),
    bankIban: optionalText(200),
    bankSwiftCode: optionalText(100),
    bankName: optionalText(200),
    bankAddress: optionalText(1000),
    bankDetails: optionalText(2000),
    pixKey: optionalText(200),
    defaultCurrency: z.enum(SUPPORTED_CURRENCIES),
    defaultPdfFilenameTemplate: optionalText(300),
  })
  .superRefine((data, ctx) => {
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
