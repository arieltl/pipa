import { z } from "zod";

const generatorKey = z.preprocess(
  (value) =>
    typeof value === "string" ? value.trim().toLowerCase() : value,
  z
    .string({ message: "Key is required" })
    .min(1, "Key is required")
    .max(64, "Key is too long")
    .regex(
      /^[a-z][a-z0-9_]*$/,
      "Use lower-case letters, numbers, and underscores",
    ),
);

export const textGeneratorFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  key: generatorKey,
  purpose: z.enum(["nfse-description", "custom"]),
  source: z.string().min(1, "Template is required").max(20_000, "Template is too long"),
});

export type TextGeneratorFormInput = z.infer<typeof textGeneratorFormSchema>;
