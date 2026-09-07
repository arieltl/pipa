import { z } from "zod";
import { recordAttachmentDefinitionsSchema, recordFieldDefinitionsSchema } from "../../domain/invoice-records.ts";

const jsonArray = (schema: typeof recordFieldDefinitionsSchema | typeof recordAttachmentDefinitionsSchema) =>
  z.string().transform((source, ctx) => {
    try { return schema.parse(JSON.parse(source)); }
    catch { ctx.addIssue({ code: "custom", message: "Invalid field configuration" }); return z.NEVER; }
  });

export const invoiceRecordTypeFormSchema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(100),
  key: z.string().trim().min(1).max(64).regex(/^[a-z][a-z0-9_]*$/, "Use lowercase letters, numbers, and underscores"),
  purpose: z.enum(["nfse", "custom"]).default("custom"),
  allowMultiple: z.preprocess((value) => value === "on" || value === "true", z.boolean()),
  fieldDefinitionsJson: jsonArray(recordFieldDefinitionsSchema),
  attachmentDefinitionsJson: jsonArray(recordAttachmentDefinitionsSchema),
});

export type InvoiceRecordTypeFormInput = z.infer<typeof invoiceRecordTypeFormSchema>;
