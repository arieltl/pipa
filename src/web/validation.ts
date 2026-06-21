import { z } from "zod";
import type { FieldErrors } from "./components/forms.tsx";

/**
 * Reduce a ZodError to a flat map of `field -> first message`, which is what
 * the {@link Field} component consumes. Nested paths are joined with dots.
 */
export function fieldErrorsFromZod(error: z.ZodError): FieldErrors {
  const result: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    if (result[key] === undefined) {
      result[key] = issue.message;
    }
  }
  return result;
}
