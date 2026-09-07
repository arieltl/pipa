import { z } from "zod";

const stableKey = z.string().trim().min(1).max(64).regex(/^[a-z][a-z0-9_]*$/, "Use lowercase letters, numbers, and underscores");

export const recordFieldKindSchema = z.enum([
  "text", "multiline", "date", "url", "number", "boolean", "select",
]);

export const recordFieldDefinitionSchema = z.object({
  key: stableKey,
  label: z.string().trim().min(1).max(100),
  kind: recordFieldKindSchema,
  required: z.boolean().default(false),
  choices: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
}).superRefine((field, ctx) => {
  if (field.kind === "select" && field.choices.length === 0) {
    ctx.addIssue({ code: "custom", path: ["choices"], message: "Select fields need at least one choice" });
  }
});

export const recordAttachmentDefinitionSchema = z.object({
  key: stableKey,
  label: z.string().trim().min(1).max(100),
  acceptedTypes: z.array(z.string().trim().min(1).max(100)).max(30).default([]),
  maximumCount: z.number().int().min(1).max(20).default(1),
  required: z.boolean().default(false),
});

export type RecordFieldDefinition = z.infer<typeof recordFieldDefinitionSchema>;
export type RecordAttachmentDefinition = z.infer<typeof recordAttachmentDefinitionSchema>;

export const recordFieldDefinitionsSchema = z.array(recordFieldDefinitionSchema).max(50).superRefine(uniqueKeys);
export const recordAttachmentDefinitionsSchema = z.array(recordAttachmentDefinitionSchema).max(20).superRefine(uniqueKeys);

function uniqueKeys(values: Array<{ key: string }>, ctx: z.RefinementCtx) {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    const key = value.key.toLowerCase();
    if (seen.has(key)) ctx.addIssue({ code: "custom", path: [index, "key"], message: "Keys must be unique" });
    seen.add(key);
  });
}

export function parseRecordDefinitions(fieldsJson: string, attachmentsJson: string) {
  return {
    fields: recordFieldDefinitionsSchema.parse(JSON.parse(fieldsJson)),
    attachments: recordAttachmentDefinitionsSchema.parse(JSON.parse(attachmentsJson)),
  };
}

export const nfseRecordPreset = {
  key: "nfse",
  name: "NFS-e",
  purpose: "nfse" as const,
  fields: [
    { key: "number", label: "NFS-e number", kind: "text" as const, required: false, choices: [] },
    { key: "issue_date", label: "Issue date", kind: "date" as const, required: false, choices: [] },
    { key: "verification_code", label: "Verification code", kind: "text" as const, required: false, choices: [] },
    { key: "public_url", label: "Public URL", kind: "url" as const, required: false, choices: [] },
    { key: "notes", label: "Notes", kind: "multiline" as const, required: false, choices: [] },
  ],
  attachments: [
    { key: "pdf", label: "PDF", acceptedTypes: ["application/pdf"], maximumCount: 1, required: false },
    { key: "xml", label: "XML", acceptedTypes: ["application/xml", "text/xml"], maximumCount: 1, required: false },
  ],
};
