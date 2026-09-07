import { z } from "zod";

export const htmlTemplateFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  source: z.string().min(1, "HTML source is required").max(20_000),
});

export const duplicateTemplateSchema = z.object({
  name: z.string().trim().max(120).optional(),
});
