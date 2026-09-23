import { Liquid } from "liquidjs";
import type { InvoiceDocumentModel } from "../document-model.ts";
import { monthNameEn, monthNamePt } from "../../domain/dates.ts";
import {
  findPackageFile,
  type TemplatePackage,
  TemplatePackageError,
  validateTemplatePackage,
} from "../../domain/template-package.ts";

const MAX_SOURCE_LENGTH = 20_000;
const MAX_OUTPUT_LENGTH = 100_000;
const MAX_HTML_OUTPUT_LENGTH = 500_000;
const MAX_PACKAGE_TEXT_LENGTH = 200 * 1024;
const FORBIDDEN_TAG = /{%\s*(include|render|layout)\b/i;

const plainTextEngine = new Liquid({
  strictFilters: true,
  strictVariables: true,
  lenientIf: true,
  ownPropertyOnly: true,
  templates: {},
  parseLimit: MAX_SOURCE_LENGTH,
  renderLimit: 1_000,
  memoryLimit: 10_000_000,
});

const htmlEngine = new Liquid({
  strictFilters: true,
  strictVariables: true,
  lenientIf: true,
  ownPropertyOnly: true,
  outputEscape: "escape",
  templates: {},
  parseLimit: MAX_SOURCE_LENGTH,
  renderLimit: 1_000,
  memoryLimit: 10_000_000,
});

export class LiquidSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LiquidSourceError";
  }
}

function assertAllowedSource(source: string): void {
  if (source.length > MAX_SOURCE_LENGTH) {
    throw new LiquidSourceError(
      `Template is too long (maximum ${MAX_SOURCE_LENGTH.toLocaleString()} characters)`,
    );
  }
  const forbidden = source.match(FORBIDDEN_TAG)?.[1];
  if (forbidden) {
    throw new LiquidSourceError(`The Liquid “${forbidden}” tag is not allowed`);
  }
}

/** Parse and policy-check source without needing an invoice. */
export function validateLiquidSource(source: string): void {
  assertAllowedSource(source);
  try {
    plainTextEngine.parse(source);
  } catch (error) {
    throw new LiquidSourceError(
      error instanceof Error ? error.message : "Invalid Liquid template",
    );
  }
}

function assertCompleteHtml(source: string): void {
  const required = [
    [/<!doctype\s+html[\s>]/i, "<!doctype html>"],
    [/<html(?:\s|>)/i, "<html>"],
    [/<head(?:\s|>)/i, "<head>"],
    [/<body(?:\s|>)/i, "<body>"],
  ] as const;
  const missing = required.find(([pattern]) => !pattern.test(source));
  if (missing) {
    throw new LiquidSourceError(
      `HTML template must be a complete document containing ${missing[1]}`,
    );
  }
}

function assertSelfContainedHtml(source: string): void {
  if (/<(?:script|iframe|object|embed|link|video|audio|source|image)\b/i.test(source)) {
    throw new LiquidSourceError(
      "HTML templates must be self-contained and cannot load scripts or external resources",
    );
  }
  if (/@import\b/i.test(source)) {
    throw new LiquidSourceError("CSS @import is not allowed in HTML templates");
  }
  for (const match of source.matchAll(/<img\b[^>]*>/gi)) {
    const src = match[0].match(/\bsrc\s*=\s*(["'])(.*?)\1/i)?.[2]?.trim();
    if (!src?.toLowerCase().startsWith("data:image/")) {
      throw new LiquidSourceError(
        "Images in HTML templates must use a self-contained data:image URL",
      );
    }
  }
  for (const match of source.matchAll(/url\s*\((.*?)\)/gi)) {
    const value = match[1]?.trim().replace(/^(["'])(.*)\1$/, "$2") ?? "";
    if (!value.toLowerCase().startsWith("data:")) {
      throw new LiquidSourceError(
        "CSS resources in HTML templates must use self-contained data URLs",
      );
    }
  }
  if (/\bfile\s*:/i.test(source)) {
    throw new LiquidSourceError("Filesystem URLs are not allowed in HTML templates");
  }
}

export function validateLiquidHtmlSource(source: string): void {
  assertAllowedSource(source);
  assertCompleteHtml(source);
  assertSelfContainedHtml(source);
  try {
    htmlEngine.parse(source);
  } catch (error) {
    throw new LiquidSourceError(
      error instanceof Error ? error.message : "Invalid Liquid template",
    );
  }
}

function packageLiquidEngine(templatePackage: TemplatePackage): Liquid {
  return new Liquid({
    strictFilters: true,
    strictVariables: true,
    lenientIf: true,
    ownPropertyOnly: true,
    outputEscape: "escape",
    // `templates` is an in-memory map. Liquid must never resolve a package
    // partial from the process filesystem or another template revision.
    templates: Object.fromEntries(
      templatePackage.files
        .filter((file) => file.encoding === "utf8")
        .map((file) => [file.path, file.content]),
    ),
    parseLimit: MAX_PACKAGE_TEXT_LENGTH,
    renderLimit: 1_000,
    memoryLimit: 10_000_000,
  });
}

/** Validate a package whose entry is a complete HTML/Liquid document. */
export function validateLiquidHtmlPackage(input: TemplatePackage): TemplatePackage {
  let templatePackage: TemplatePackage;
  try {
    templatePackage = validateTemplatePackage(input);
  } catch (error) {
    throw new LiquidSourceError(error instanceof Error ? error.message : "Invalid template package");
  }
  const entry = findPackageFile(templatePackage, templatePackage.entry);
  if (!entry || entry.encoding !== "utf8") throw new LiquidSourceError("Template package entry index.html is missing");
  assertCompleteHtml(entry.content);
  try {
    const engine = packageLiquidEngine(templatePackage);
    for (const file of templatePackage.files) {
      if (file.encoding === "utf8") engine.parse(file.content, file.path);
    }
  } catch (error) {
    throw new LiquidSourceError(error instanceof Error ? error.message : "Invalid Liquid template package");
  }
  return templatePackage;
}

function liquidScope(document: InvoiceDocumentModel) {
  const legacyField = (key: string) => document.customer.field[key]?.value ?? "";
  const legacyIssuerField = (key: string) => document.issuer.field[key]?.value ?? "";
  return {
    ...document,
    client: {
      name: document.customer.name,
      code: document.customer.code ?? "",
      legalName: legacyField("legal_name"),
      country: legacyField("country"),
      email: legacyField("email"),
    },
    issuer: {
      ...document.issuer,
      legalName: legacyIssuerField("legal_name"),
    },
    invoice: {
      ...document.invoice,
      date: document.invoice.dateDisplay,
      dateMonthName: monthNameEn(document.invoice.dateIso),
      dateMonthNamePt: monthNamePt(document.invoice.dateIso),
      total: document.total.decimal,
    },
  };
}

/** Render literal plain text (no HTML escaping) from the snapshot-only model. */
export function renderLiquidPlainText(
  source: string,
  document: InvoiceDocumentModel,
): string {
  validateLiquidSource(source);
  try {
    // Temporary compatibility aliases let migrated legacy NFS-e templates keep
    // rendering while new templates use `customer` and the documented model.
    const output = String(
      plainTextEngine.parseAndRenderSync(source, liquidScope(document), {
        strictVariables: true,
        ownPropertyOnly: true,
        renderLimit: 1_000,
        memoryLimit: 10_000_000,
        templateLimit: 10_000,
      }),
    );
    if (output.length > MAX_OUTPUT_LENGTH) {
      throw new LiquidSourceError(
        `Generated text is too long (maximum ${MAX_OUTPUT_LENGTH.toLocaleString()} characters)`,
      );
    }
    return output;
  } catch (error) {
    if (error instanceof LiquidSourceError) throw error;
    throw new LiquidSourceError(
      error instanceof Error ? error.message : "Liquid rendering failed",
    );
  }
}

/** Render a complete HTML document with escaped interpolated values. */
export function renderLiquidHtml(
  source: string,
  document: InvoiceDocumentModel,
): string {
  validateLiquidHtmlSource(source);
  try {
    const output = String(
      htmlEngine.parseAndRenderSync(source, liquidScope(document), {
        strictVariables: true,
        ownPropertyOnly: true,
        renderLimit: 1_000,
        memoryLimit: 10_000_000,
        templateLimit: 10_000,
      }),
    );
    assertCompleteHtml(output);
    if (output.length > MAX_HTML_OUTPUT_LENGTH) {
      throw new LiquidSourceError(
        `Rendered HTML is too long (maximum ${MAX_HTML_OUTPUT_LENGTH.toLocaleString()} characters)`,
      );
    }
    return output;
  } catch (error) {
    if (error instanceof LiquidSourceError) throw error;
    throw new LiquidSourceError(
      error instanceof Error ? error.message : "Liquid HTML rendering failed",
    );
  }
}

/**
 * Render the entry document from an isolated, in-memory package. Liquid's
 * `render` tag can resolve only literal paths which package validation already
 * proved belong to this revision. The returned package has no partial files;
 * those are authoring inputs, not Chromium resources.
 */
export function renderLiquidHtmlPackage(
  input: TemplatePackage,
  document: InvoiceDocumentModel,
): TemplatePackage {
  const templatePackage = validateLiquidHtmlPackage(input);
  const entry = findPackageFile(templatePackage, templatePackage.entry)!;
  try {
    const output = String(
      packageLiquidEngine(templatePackage).parseAndRenderSync(entry.content, liquidScope(document), {
        strictVariables: true,
        ownPropertyOnly: true,
        renderLimit: 1_000,
        memoryLimit: 10_000_000,
        templateLimit: 10_000,
      }),
    );
    assertCompleteHtml(output);
    if (output.length > MAX_HTML_OUTPUT_LENGTH) {
      throw new LiquidSourceError(`Rendered HTML is too long (maximum ${MAX_HTML_OUTPUT_LENGTH.toLocaleString()} characters)`);
    }
    // Check the rendered attributes as well. A Liquid value must not turn a
    // local resource reference into a network or filesystem request.
    return validateTemplatePackage({
      ...templatePackage,
      files: templatePackage.files
        .filter((file) => !file.path.endsWith(".liquid"))
        .map((file) => file.path === templatePackage.entry ? { ...file, content: output } : file),
    });
  } catch (error) {
    if (error instanceof LiquidSourceError) throw error;
    if (error instanceof TemplatePackageError) throw new LiquidSourceError(error.message);
    throw new LiquidSourceError(error instanceof Error ? error.message : "Liquid HTML rendering failed");
  }
}
