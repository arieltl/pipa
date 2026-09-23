import { z } from "zod";

export const htmlTemplateFormSchema = z
  .object({
    engine: z.enum(["react-pdf", "gotenberg-html"]).optional(),
    name: z.string().trim().min(1, "Name is required").max(120),
    source: z
      .string()
      .min(1, "Template source is required")
      .max(200 * 1024)
      .optional(),
    packageJson: z
      .string()
      .max(12 * 1024 * 1024, "Template package is too large")
      .optional(),
  })
  .refine(
    (value) => Boolean(value.source?.trim() || value.packageJson?.trim()),
    {
      message: "Template source or a template package is required",
      path: ["source"],
    },
  );

/** The editor preview accepts source only; it never creates a template revision. */
export const htmlTemplatePreviewSchema = z
  .object({
    engine: z.enum(["react-pdf", "gotenberg-html"]).optional(),
    source: z
      .string()
      .min(1, "Template source is required")
      .max(200 * 1024, "Template source must be no longer than 204,800 characters")
      .optional(),
    packageJson: z
      .string()
      .max(12 * 1024 * 1024, "Template package is too large")
      .optional(),
    previewData: z.string().max(100 * 1024, "Preview data is too large").optional(),
  })
  .refine(
    (value) => Boolean(value.source?.trim() || value.packageJson?.trim()),
    {
      message: "Template source or a template package is required",
      path: ["source"],
    },
  );

export const duplicateTemplateSchema = z.object({
  name: z.string().trim().max(120).optional(),
});
