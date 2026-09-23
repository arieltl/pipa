import {
  getGotenbergConfig,
  type GotenbergConfig,
} from "../../config/gotenberg.ts";
import {
  decodePackageFile,
  type TemplatePackage,
} from "../../domain/template-package.ts";
import { createHash } from "node:crypto";
import { posix as path } from "node:path";
import { parse, serialize } from "parse5";
import csstree from "../../domain/css-tree";

class GotenbergError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class GotenbergNotConfiguredError extends GotenbergError {}
export class GotenbergTimeoutError extends GotenbergError {}
export class GotenbergConnectionError extends GotenbergError {}
export class GotenbergRequestError extends GotenbergError {}
export class GotenbergUnavailableError extends GotenbergError {}
export class GotenbergInvalidResponseError extends GotenbergError {}
export class GotenbergInvalidPdfError extends GotenbergError {}

export type GotenbergPdfOptions = {
  printBackground?: boolean;
  preferCssPageSize?: boolean;
};

function resolvePackagePath(
  base: string,
  reference: string,
): string | undefined {
  if (!reference || reference.startsWith("#") || /^data:/i.test(reference))
    return undefined;
  const pathname = reference.split(/[?#]/, 1)[0]!;
  return path.normalize(
    path.join(path.dirname(base), decodeURIComponent(pathname)),
  );
}

function flatName(filePath: string): string {
  const suffix = filePath.split(".").at(-1);
  const base = filePath
    .split("/")
    .at(-1)!
    .replace(/[^a-z0-9_-]/gi, "-");
  return `${createHash("sha256").update(filePath).digest("hex").slice(0, 12)}-${base}${suffix && !base.endsWith(`.${suffix}`) ? `.${suffix}` : ""}`;
}

function rewriteCss(
  css: string,
  base: string,
  names: Map<string, string>,
  context: "stylesheet" | "declarationList" = "stylesheet",
): string {
  const ast: any = csstree.parse(css, {
    context,
    parseCustomProperty: true,
    onParseError: (error: Error) => {
      throw error;
    },
  });
  csstree.walk(ast, (node: any) => {
    if (node.type === "Url") {
      const value =
        typeof node.value === "string" ? node.value : node.value?.value;
      const replacement =
        typeof value === "string"
          ? names.get(resolvePackagePath(base, value) ?? "")
          : undefined;
      if (replacement) node.value = replacement;
    }
    if (
      node.type === "Atrule" &&
      String(node.name).toLowerCase() === "import"
    ) {
      csstree.walk(node.prelude, (part: any) => {
        if (part.type !== "String" && part.type !== "Url") return;
        const value =
          part.type === "String"
            ? part.value
            : typeof part.value === "string"
              ? part.value
              : part.value?.value;
        const replacement =
          typeof value === "string"
            ? names.get(resolvePackagePath(base, value) ?? "")
            : undefined;
        if (!replacement) return;
        if (part.type === "String") part.value = replacement;
        else part.value = replacement;
      });
    }
  });
  return csstree.generate(ast);
}

/**
 * Gotenberg receives multipart file basenames, not a directory tree. Flatten
 * only the transient renderer copy and rewrite parsed HTML/CSS references to
 * the deterministic filenames. Stored revisions and exports retain paths.
 */
export function flattenPackageForGotenberg(
  templatePackage: TemplatePackage,
): TemplatePackage {
  const names = new Map(
    templatePackage.files.map((file) => [
      file.path,
      file.path === templatePackage.entry ? file.path : flatName(file.path),
    ]),
  );
  const rewriteHtml = (html: string) => {
    const document: any = parse(html);
    const walk = (node: any): void => {
      if (node.tagName) {
        for (const attribute of node.attrs ?? []) {
          if (
            (node.tagName === "img" && attribute.name === "src") ||
            (node.tagName === "link" && attribute.name === "href")
          ) {
            const replacement = names.get(
              resolvePackagePath(templatePackage.entry, attribute.value) ?? "",
            );
            if (replacement) attribute.value = replacement;
          }
          if (attribute.name === "style")
            attribute.value = rewriteCss(
              attribute.value,
              templatePackage.entry,
              names,
              "declarationList",
            );
        }
        if (node.tagName === "style") {
          for (const child of node.childNodes ?? [])
            if (typeof child.value === "string")
              child.value = rewriteCss(
                child.value,
                templatePackage.entry,
                names,
              );
        }
      }
      for (const child of node.childNodes ?? []) walk(child);
    };
    walk(document);
    return serialize(document);
  };
  return {
    ...templatePackage,
    files: templatePackage.files.map((file) => ({
      ...file,
      path: names.get(file.path)!,
      content:
        file.path === templatePackage.entry
          ? rewriteHtml(file.content)
          : file.path.endsWith(".css")
            ? rewriteCss(file.content, file.path, names)
            : file.content,
    })),
  };
}

export async function convertHtmlToPdf(
  html: string,
  traceId: string,
  options: GotenbergPdfOptions = {},
  config = getGotenbergConfig(),
): Promise<Buffer> {
  return convertHtmlPackageToPdf(
    {
      version: 1,
      entry: "index.html",
      files: [{ path: "index.html", content: html, encoding: "utf8" }],
    },
    traceId,
    options,
    config,
    false,
  );
}

/** Convert a fully rendered package. Every multipart file comes from the same immutable revision. */
export async function convertHtmlPackageToPdf(
  templatePackage: TemplatePackage,
  traceId: string,
  options: GotenbergPdfOptions = {},
  config = getGotenbergConfig(),
  flatten = true,
): Promise<Buffer> {
  if (!config)
    throw new GotenbergNotConfiguredError("Gotenberg is not configured");
  const form = new FormData();
  const transportPackage = flatten
    ? flattenPackageForGotenberg(templatePackage)
    : templatePackage;
  for (const file of transportPackage.files) {
    // The package validator has already rejected absolute, traversal, and
    // duplicate names. Chromium resolves these multipart filenames relative
    // to index.html inside Gotenberg's temporary work directory.
    form.append(
      "files",
      new File([Uint8Array.from(decodePackageFile(file))], file.path, {
        type: file.path.endsWith(".html")
          ? "text/html; charset=utf-8"
          : undefined,
      }),
    );
  }
  form.append("printBackground", String(options.printBackground ?? true));
  form.append("preferCssPageSize", String(options.preferCssPageSize ?? true));

  let response: Response;
  try {
    response = await fetch(`${config.url}/forms/chromium/convert/html`, {
      method: "POST",
      headers: { "Gotenberg-Trace": traceId },
      body: form,
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (error) {
    if (
      error instanceof DOMException &&
      (error.name === "TimeoutError" || error.name === "AbortError")
    ) {
      throw new GotenbergTimeoutError(
        `Gotenberg did not respond within ${config.timeoutMs} ms`,
      );
    }
    throw new GotenbergConnectionError(
      error instanceof Error ? error.message : "Could not connect to Gotenberg",
    );
  }

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 2_000).trim();
    const message = `Gotenberg returned ${response.status}${detail ? `: ${detail}` : ""}`;
    if (response.status >= 500) throw new GotenbergUnavailableError(message);
    throw new GotenbergRequestError(message);
  }

  const declaredSize = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredSize) && declaredSize > config.maxResponseBytes) {
    throw new GotenbergInvalidResponseError(
      "Gotenberg PDF response is too large",
    );
  }
  const contentType = response.headers.get("content-type");
  if (contentType && !contentType.toLowerCase().includes("application/pdf")) {
    throw new GotenbergInvalidResponseError(
      `Gotenberg returned ${contentType} instead of application/pdf`,
    );
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > config.maxResponseBytes) {
    throw new GotenbergInvalidResponseError(
      "Gotenberg PDF response is too large",
    );
  }
  if (!buffer.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    throw new GotenbergInvalidPdfError(
      "Gotenberg response does not contain a valid PDF signature",
    );
  }
  return buffer;
}

export async function checkGotenbergHealth(
  config: GotenbergConfig | null = getGotenbergConfig(),
): Promise<"unconfigured" | "healthy" | "unhealthy"> {
  if (!config) return "unconfigured";
  try {
    const response = await fetch(`${config.url}/health`, {
      signal: AbortSignal.timeout(Math.min(config.timeoutMs, 5_000)),
    });
    return response.ok ? "healthy" : "unhealthy";
  } catch {
    return "unhealthy";
  }
}
