import { renderTemplate, type TemplateContext } from "./template-engine.ts";

/**
 * PDF filename generation (architecture plan §"Template Engine" — "Sanitize
 * separately for filename output"; security notes — never trust template/user
 * input as a stored path).
 *
 * A rendered filename template is sanitized into a single safe path segment:
 * no directory separators, no `..` traversal, no control/reserved characters.
 * The result is always a non-empty `*.pdf` basename.
 */

/**
 * Reduce an arbitrary string to one safe filename segment. Strips path
 * separators and `..` traversal, allows only `[A-Za-z0-9._-]`, and trims
 * leading/trailing separators. Returns "" when nothing safe remains (callers
 * supply a fallback).
 */
export function sanitizeFilename(input: string): string {
  return input
    .replace(/[\\/]+/g, "-") // path separators -> dash (defeats traversal)
    .replace(/\s+/g, "_") // whitespace -> underscore
    .replace(/[^A-Za-z0-9._-]/g, "") // allowlist safe characters only
    .replace(/\.{2,}/g, ".") // collapse dot runs so no ".." survives
    .replace(/^[.\-_]+|[.\-_]+$/g, ""); // trim leading/trailing separators
}

/** Ensure a single `.pdf` extension (case-insensitive). */
function withPdfExtension(name: string): string {
  return /\.pdf$/i.test(name) ? name : `${name}.pdf`;
}

/**
 * Render a filename template against the context and return a safe `*.pdf`
 * basename. Unknown template variables collapse away during sanitization, so
 * the fallback is used whenever the template is empty or yields nothing safe.
 */
export function renderFilename(
  template: string | null | undefined,
  context: TemplateContext,
  fallback: string,
): string {
  const safeFallback = withPdfExtension(
    sanitizeFilename(fallback) || "invoice",
  );
  if (!template || template.trim() === "") return safeFallback;

  const rendered = renderTemplate(template, context).output;
  // Remove any unresolved `{{...}}` markers before sanitizing.
  const stripped = rendered.replace(/\{\{[^}]*\}\}/g, "");
  const safe = sanitizeFilename(stripped);
  return safe === "" ? safeFallback : withPdfExtension(safe);
}
