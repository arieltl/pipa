/** Raw parsed form body from Hono's `c.req.parseBody()`. */
export type FormBody = Record<string, string | File>;

/** Coerce a possibly-File / missing form value to a string for re-rendering. */
export function formString(value: string | File | undefined | null): string {
  return typeof value === "string" ? value : "";
}

/** Null/undefined DB column to empty string for input `value` attributes. */
export function str(value: string | null | undefined): string {
  return value ?? "";
}
