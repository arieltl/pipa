import { z } from "zod";
import {
  isResetPeriod,
  unknownNumberPatternTokens,
} from "../../domain/numbering.ts";
import { requiredText } from "../../web/form-schema.ts";

const resetPeriod = z
  .string()
  .refine(isResetPeriod, "Choose when the sequence should reset");

export const numberingProfileFormSchema = z
  .object({
    name: requiredText("Name", 120),
    pattern: requiredText("Pattern", 200),
    resetPeriod,
  })
  .superRefine((data, ctx) => {
    const unknown = unknownNumberPatternTokens(data.pattern);
    if (unknown.length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["pattern"],
        message: `Unsupported token: ${unknown[0]}`,
      });
    }
  });

export type NumberingProfileFormInput = z.infer<
  typeof numberingProfileFormSchema
>;

export const sequenceFormSchema = z.object({
  nextSeq: z.preprocess(
    (v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v),
    z.number({ message: "Enter the next sequence" }).int().positive(),
  ),
});

export type SequenceFormInput = z.infer<typeof sequenceFormSchema>;
