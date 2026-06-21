import { z } from "zod";

/**
 * Form bodies arrive as strings; blank optional fields should become
 * `undefined` rather than empty strings before validation. These helpers
 * centralize that coercion for the feature schemas.
 */

const blankToUndefined = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? undefined : v;

/** Required, trimmed text with a friendly required-message. */
export function requiredText(label: string, max = 500) {
  return z
    .string({ message: `${label} is required` })
    .trim()
    .min(1, `${label} is required`)
    .max(max, `${label} is too long`);
}

/** Optional, trimmed text; blank becomes undefined. */
export function optionalText(max = 2000) {
  return z.preprocess(
    blankToUndefined,
    z.string().trim().max(max, "Too long").optional(),
  );
}

/** Optional email; blank becomes undefined, otherwise must be valid. */
export function optionalEmail() {
  return z.preprocess(
    blankToUndefined,
    z.email("Enter a valid email address").optional(),
  );
}
