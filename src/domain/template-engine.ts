/**
 * Tiny, safe `{{path.to.value}}` interpolation engine (architecture plan
 * §"Template Engine"). Used for fixed monthly item names, nota fiscal
 * descriptions, and (via filename-template.ts) PDF filenames.
 *
 * Rules:
 * - Only flat, known dotted paths are substituted. No JavaScript is executed,
 *   no helper calls, no loops — formatting is precomputed into the context
 *   (e.g. `invoice.dateMonthNamePt`) rather than expressed in templates.
 * - Unknown variables are left as their literal `{{path}}` marker so they are
 *   visible in draft output, and are also reported for validation in settings.
 */

/** A flat map of `"invoice.number" -> "ACME-..."`. */
export type TemplateContext = Record<string, string>;

export type RenderResult = {
  output: string;
  /** Distinct variable paths referenced but not present in the context. */
  unknownVars: string[];
};

const TOKEN_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

/**
 * Render `template` against `context`. Known variables are substituted;
 * unknown ones are preserved verbatim (`{{path}}`) and collected.
 */
export function renderTemplate(
  template: string,
  context: TemplateContext,
): RenderResult {
  const unknown = new Set<string>();
  const output = template.replace(TOKEN_RE, (whole, path: string) => {
    if (Object.hasOwn(context, path)) return context[path]!;
    unknown.add(path);
    return whole;
  });
  return { output, unknownVars: [...unknown] };
}

/** Every distinct variable path referenced by a template, in first-seen order. */
export function templateVariables(template: string): string[] {
  const seen = new Set<string>();
  for (const match of template.matchAll(TOKEN_RE)) {
    seen.add(match[1]!);
  }
  return [...seen];
}

/**
 * Variables used by a template that are not in `allowed`. Drives validation
 * errors on settings screens so a typo like `{{client.naem}}` is caught before
 * it silently never resolves.
 */
export function unknownTemplateVariables(
  template: string,
  allowed: Iterable<string>,
): string[] {
  const allowedSet = new Set(allowed);
  return templateVariables(template).filter((v) => !allowedSet.has(v));
}
