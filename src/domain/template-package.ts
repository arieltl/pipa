import { createHash } from "node:crypto";
import { posix as path } from "node:path";
import { Unzip, UnzipInflate, strFromU8, strToU8, zipSync } from "fflate";
import { parse } from "parse5";
import * as csstree from "css-tree";

export const TEMPLATE_PACKAGE_ENTRY = "index.html" as const;
export const MAX_TEMPLATE_PACKAGE_FILES = 64;
export const MAX_TEMPLATE_TEXT_FILE_BYTES = 200 * 1024;
export const MAX_TEMPLATE_PACKAGE_BYTES = 8 * 1024 * 1024;
export const MAX_TEMPLATE_ZIP_BYTES = 10 * 1024 * 1024;
const MAX_PARTIAL_DEPTH = 16;

export type TemplatePackageFile = {
  path: string;
  content: string;
  encoding: "utf8" | "base64";
};

export type TemplatePackage = {
  version: 1;
  entry: typeof TEMPLATE_PACKAGE_ENTRY;
  files: TemplatePackageFile[];
};

export class TemplatePackageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplatePackageError";
  }
}

const imageExtensions = new Set(["png", "jpg", "jpeg", "webp", "gif"]);
const textDecoder = new TextDecoder("utf-8", { fatal: true });

function extension(filePath: string): string {
  return filePath.split(".").at(-1)?.toLowerCase() ?? "";
}

function isImagePath(filePath: string): boolean {
  return imageExtensions.has(extension(filePath));
}

function assertPath(value: string): string {
  if (
    !value ||
    value.length > 240 ||
    value.includes("\\") ||
    value.includes("\0")
  ) {
    throw new TemplatePackageError(
      "Template file paths must be short, non-empty relative paths",
    );
  }
  if (
    value.startsWith("/") ||
    /^[a-z]:/i.test(value) ||
    value.split("/").some((part) => part === "." || part === ".." || !part)
  ) {
    throw new TemplatePackageError(
      `Template file path “${value}” is not a safe relative path`,
    );
  }
  return value;
}

function bytesFor(file: TemplatePackageFile): Uint8Array {
  try {
    if (file.encoding === "utf8") return strToU8(file.content);
    if (
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        file.content,
      )
    ) {
      throw new Error("invalid base64");
    }
    return Uint8Array.from(Buffer.from(file.content, "base64"));
  } catch {
    throw new TemplatePackageError(
      `Template file “${file.path}” has invalid ${file.encoding} content`,
    );
  }
}

function assertFile(file: TemplatePackageFile): void {
  assertPath(file.path);
  if (file.encoding !== "utf8" && file.encoding !== "base64") {
    throw new TemplatePackageError(
      `Template file “${file.path}” has an unsupported encoding`,
    );
  }
  if (isImagePath(file.path) !== (file.encoding === "base64")) {
    throw new TemplatePackageError(
      isImagePath(file.path)
        ? `Image file “${file.path}” must use base64 encoding`
        : `Only PNG, JPG, JPEG, WEBP, and GIF files may use base64 encoding`,
    );
  }
  const bytes = bytesFor(file);
  if (file.encoding === "base64") assertImageSignature(file.path, bytes);
  if (file.encoding === "utf8" && bytes.length > MAX_TEMPLATE_TEXT_FILE_BYTES) {
    throw new TemplatePackageError(
      `Text file “${file.path}” exceeds the 200 KB limit`,
    );
  }
}

function assertImageSignature(filePath: string, bytes: Uint8Array): void {
  const starts = (...expected: number[]) =>
    expected.every((byte, index) => bytes[index] === byte);
  const kind = extension(filePath);
  const valid =
    kind === "png"
      ? starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
      : kind === "jpg" || kind === "jpeg"
        ? starts(0xff, 0xd8, 0xff)
        : kind === "gif"
          ? starts(0x47, 0x49, 0x46, 0x38) &&
            (bytes[4] === 0x37 || bytes[4] === 0x39) &&
            bytes[5] === 0x61
          : kind === "webp"
            ? starts(0x52, 0x49, 0x46, 0x46) &&
              startsAt(bytes, 8, 0x57, 0x45, 0x42, 0x50)
            : false;
  if (!valid)
    throw new TemplatePackageError(
      `Image file “${filePath}” does not match its declared format`,
    );
}

function startsAt(
  bytes: Uint8Array,
  offset: number,
  ...expected: number[]
): boolean {
  return expected.every((byte, index) => bytes[offset + index] === byte);
}

function canonicalFiles(files: TemplatePackageFile[]): TemplatePackageFile[] {
  return [...files].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
}

/** Normalizes a package and verifies that all renderer-visible dependencies are local. */
export function validateTemplatePackage(
  input: TemplatePackage,
): TemplatePackage {
  if (
    !input ||
    input.version !== 1 ||
    input.entry !== TEMPLATE_PACKAGE_ENTRY ||
    !Array.isArray(input.files)
  ) {
    throw new TemplatePackageError(
      "Template package must use version 1 and entry index.html",
    );
  }
  if (!input.files.length || input.files.length > MAX_TEMPLATE_PACKAGE_FILES) {
    throw new TemplatePackageError(
      `Template packages may contain 1 to ${MAX_TEMPLATE_PACKAGE_FILES} files`,
    );
  }
  const seen = new Set<string>();
  let totalBytes = 0;
  for (const file of input.files) {
    if (
      !file ||
      typeof file.path !== "string" ||
      typeof file.content !== "string"
    ) {
      throw new TemplatePackageError(
        "Every template package file needs a path and content",
      );
    }
    assertFile(file);
    const caseInsensitivePath = file.path.toLocaleLowerCase("en-US");
    if (seen.has(caseInsensitivePath))
      throw new TemplatePackageError(
        `Template package contains duplicate file “${file.path}”`,
      );
    seen.add(caseInsensitivePath);
    totalBytes += bytesFor(file).length;
  }
  if (totalBytes > MAX_TEMPLATE_PACKAGE_BYTES) {
    throw new TemplatePackageError(
      "Template package exceeds the 8 MiB decoded size limit",
    );
  }
  const files = canonicalFiles(input.files.map((file) => ({ ...file })));
  const packageValue: TemplatePackage = {
    version: 1,
    entry: TEMPLATE_PACKAGE_ENTRY,
    files,
  };
  const entry = findPackageFile(packageValue, TEMPLATE_PACKAGE_ENTRY);
  if (!entry || entry.encoding !== "utf8")
    throw new TemplatePackageError(
      "Template package must contain UTF-8 index.html",
    );
  validatePackageReferences(packageValue);
  return packageValue;
}

export function packageFromSource(source: string): TemplatePackage {
  return validateTemplatePackage({
    version: 1,
    entry: TEMPLATE_PACKAGE_ENTRY,
    files: [
      { path: TEMPLATE_PACKAGE_ENTRY, content: source, encoding: "utf8" },
    ],
  });
}

export function parseTemplatePackage(value: string): TemplatePackage {
  try {
    return validateTemplatePackage(JSON.parse(value) as TemplatePackage);
  } catch (error) {
    if (error instanceof TemplatePackageError) throw error;
    throw new TemplatePackageError("Template package JSON is invalid");
  }
}

export function serializeTemplatePackage(
  templatePackage: TemplatePackage,
): string {
  return JSON.stringify(validateTemplatePackage(templatePackage));
}

export function findPackageFile(
  templatePackage: TemplatePackage,
  filePath: string,
): TemplatePackageFile | undefined {
  return templatePackage.files.find((file) => file.path === filePath);
}

export function templatePackageHash(templatePackage: TemplatePackage): string {
  return createHash("sha256")
    .update(serializeTemplatePackage(templatePackage))
    .digest("hex");
}

function localPath(base: string, reference: string): string | null {
  const raw = reference.trim();
  if (!raw || raw.startsWith("#")) return null;
  if (/^data:/i.test(raw)) {
    const match = raw.match(
      /^data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/i,
    );
    if (!match) {
      throw new TemplatePackageError(
        `Only PNG, JPG, JPEG, WEBP, and GIF data resources are allowed`,
      );
    }
    assertImageSignature(
      `image.${match[1]!.toLowerCase()}`,
      Uint8Array.from(Buffer.from(match[2]!, "base64")),
    );
    return null;
  }
  if (
    /^[a-z][a-z0-9+.-]*:/i.test(raw) ||
    raw.startsWith("//") ||
    raw.startsWith("/")
  ) {
    throw new TemplatePackageError(
      `External or absolute resource “${reference}” is not allowed`,
    );
  }
  const pathname = raw.split(/[?#]/, 1)[0]!;
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    throw new TemplatePackageError(`Resource path “${reference}” is not valid`);
  }
  if (!decoded || decoded.includes("\\"))
    throw new TemplatePackageError(`Resource path “${reference}” is not valid`);
  const resolved = path.normalize(path.join(path.dirname(base), decoded));
  if (
    resolved === ".." ||
    resolved.startsWith("../") ||
    resolved.startsWith("/")
  ) {
    throw new TemplatePackageError(
      `Resource path “${reference}” escapes the template package`,
    );
  }
  return resolved;
}

function requireLocalFile(
  templatePackage: TemplatePackage,
  base: string,
  reference: string,
  kind: string,
): void {
  const resolved = localPath(base, reference);
  if (resolved && !findPackageFile(templatePackage, resolved)) {
    throw new TemplatePackageError(
      `${kind} reference “${reference}” from “${base}” does not exist in this template package`,
    );
  }
}

function attributes(node: any): Map<string, string> {
  return new Map(
    (node.attrs ?? []).map((attribute: any) => [
      String(attribute.name).toLowerCase(),
      String(attribute.value),
    ]),
  );
}

function walkHtml(node: any, visit: (node: any) => void): void {
  visit(node);
  for (const child of node.childNodes ?? []) walkHtml(child, visit);
  if (node.content) walkHtml(node.content, visit);
}

function validateHtmlReferences(
  templatePackage: TemplatePackage,
  file: TemplatePackageFile,
): void {
  let document: any;
  try {
    document = parse(file.content, { sourceCodeLocationInfo: true });
  } catch {
    throw new TemplatePackageError(`HTML file “${file.path}” cannot be parsed`);
  }
  walkHtml(document, (node) => {
    const tag = String(node.tagName ?? "").toLowerCase();
    if (
      [
        "script",
        "iframe",
        "object",
        "embed",
        "video",
        "audio",
        "source",
      ].includes(tag)
    ) {
      throw new TemplatePackageError(
        `HTML file “${file.path}” cannot load ${tag} content`,
      );
    }
    if (["svg", "image", "use", "foreignobject"].includes(tag)) {
      throw new TemplatePackageError(
        `SVG and embedded vector content are not allowed in “${file.path}”`,
      );
    }
    const attrs = attributes(node);
    if (tag === "base") {
      throw new TemplatePackageError(
        `HTML file “${file.path}” cannot change document resource resolution`,
      );
    }
    if (
      tag === "meta" &&
      attrs.get("http-equiv")?.trim().toLowerCase() === "refresh"
    ) {
      throw new TemplatePackageError(
        `HTML file “${file.path}” cannot refresh to another resource`,
      );
    }
    if (attrs.has("srcset"))
      throw new TemplatePackageError(
        `Responsive resource attributes are not allowed in “${file.path}”`,
      );
    if (tag === "link") {
      if (attrs.get("rel")?.toLowerCase() !== "stylesheet")
        throw new TemplatePackageError(
          `HTML file “${file.path}” only permits stylesheet links`,
        );
      const href = attrs.get("href");
      if (!href)
        throw new TemplatePackageError(
          `Stylesheet link in “${file.path}” needs an href`,
        );
      requireLocalFile(templatePackage, file.path, href, "Stylesheet");
    }
    if (tag === "img") {
      const src = attrs.get("src");
      if (!src)
        throw new TemplatePackageError(`Image in “${file.path}” needs a src`);
      requireLocalFile(templatePackage, file.path, src, "Image");
    }
    for (const [name, value] of attrs) {
      if (/^on/i.test(name))
        throw new TemplatePackageError(
          `Event attributes are not allowed in “${file.path}”`,
        );
      if (
        [
          "background",
          "poster",
          "data",
          "action",
          "formaction",
          "ping",
          "cite",
        ].includes(name)
      ) {
        throw new TemplatePackageError(
          `Resource attribute “${name}” is not allowed in “${file.path}”`,
        );
      }
      if (name === "style")
        validateCssText(
          templatePackage,
          file.path,
          value,
          `Inline CSS in “${file.path}”`,
          "declarationList",
        );
      if (name === "src" && tag !== "img")
        throw new TemplatePackageError(
          `Resource-bearing <${tag}> is not allowed in “${file.path}”`,
        );
      if (name === "href" && tag === "a") {
        if (/^(?:javascript|vbscript|data):/i.test(value.trim()))
          throw new TemplatePackageError(
            `Unsafe link in “${file.path}” is not allowed`,
          );
      } else if (name === "href" && tag !== "link") localPath(file.path, value);
    }
    if (tag === "style") {
      const css = (node.childNodes ?? [])
        .map((child: any) => child.value ?? "")
        .join("");
      validateCssText(
        templatePackage,
        file.path,
        css,
        `Inline CSS in “${file.path}”`,
      );
    }
  });
}

function validateCssText(
  templatePackage: TemplatePackage,
  basePath: string,
  css: string,
  label: string,
  context: "stylesheet" | "declarationList" = "stylesheet",
): void {
  let ast: any;
  try {
    ast = csstree.parse(css, {
      context,
      parseCustomProperty: true,
      onParseError: (error: Error) => {
        throw error;
      },
    });
  } catch (error) {
    throw new TemplatePackageError(
      `${label} is invalid: ${error instanceof Error ? error.message : "parse error"}`,
    );
  }
  csstree.walk(ast, (node: any) => {
    if (
      node.type === "Raw" &&
      /\b(?:url|image-set|-webkit-image-set)\s*\(/i.test(
        String(node.value ?? ""),
      )
    ) {
      throw new TemplatePackageError(
        `${label} contains an unsupported unparsed resource value`,
      );
    }
    if (
      node.type === "Function" &&
      /^(?:-webkit-)?image-set$/i.test(String(node.name))
    ) {
      throw new TemplatePackageError(`${label} cannot use image-set resources`);
    }
    if (node.type === "Url") {
      const value =
        typeof node.value === "string" ? node.value : node.value?.value;
      if (typeof value === "string")
        requireLocalFile(templatePackage, basePath, value, "CSS resource");
    }
    if (
      node.type === "Atrule" &&
      String(node.name).toLowerCase() === "import"
    ) {
      let reference: string | undefined;
      csstree.walk(node.prelude, (part: any) => {
        if (reference !== undefined) return;
        if (part.type === "Url")
          reference =
            typeof part.value === "string" ? part.value : part.value?.value;
        if (part.type === "String") reference = part.value;
      });
      if (!reference)
        throw new TemplatePackageError(
          `CSS @import in ${label} must use a literal local path`,
        );
      requireLocalFile(templatePackage, basePath, reference, "CSS import");
    }
  });
}

function validateCssReferences(
  templatePackage: TemplatePackage,
  file: TemplatePackageFile,
): void {
  validateCssText(
    templatePackage,
    file.path,
    file.content,
    `CSS file “${file.path}”`,
  );
}

function liquidTags(source: string): Array<{ name: string; args: string }> {
  const tags: Array<{ name: string; args: string }> = [];
  const expression = /{%[-]?([\s\S]*?)[-]?%}/g;
  let ignored: "comment" | "raw" | undefined;
  for (const match of source.matchAll(expression)) {
    const content = match[1]!.trim();
    const [name = "", ...parts] = content.split(/\s+/);
    const normalized = name.toLowerCase();
    if (ignored) {
      if (normalized === `end${ignored}`) ignored = undefined;
      continue;
    }
    if (normalized === "comment" || normalized === "raw") {
      ignored = normalized;
      continue;
    }
    if (normalized === "liquid")
      throw new TemplatePackageError(
        "Liquid block tags are not allowed in template packages",
      );
    tags.push({ name: normalized, args: content.slice(name.length).trim() });
  }
  return tags;
}

function partialReferences(file: TemplatePackageFile): string[] {
  if (file.encoding !== "utf8") return [];
  const refs: string[] = [];
  for (const tag of liquidTags(file.content)) {
    if (tag.name === "include" || tag.name === "layout")
      throw new TemplatePackageError(
        `Liquid “${tag.name}” is not allowed in “${file.path}”`,
      );
    if (tag.name !== "render") continue;
    const literal = tag.args.match(
      /^['"]([^'"]+)['"](?:\s*,\s*[a-zA-Z_]\w*\s*:\s*(?:[a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*|['"][^'"]*['"]|-?\d+(?:\.\d+)?|true|false|nil|null))*\s*$/i,
    );
    if (!literal)
      throw new TemplatePackageError(
        `Liquid render in “${file.path}” must use a literal local partial path and named values`,
      );
    // Partials are package-root-relative. This makes references stable when a
    // caller moves between folders and lets the editor index them directly.
    const partialPath = literal[1]!;
    assertPath(partialPath);
    if (!partialPath.endsWith(".liquid"))
      throw new TemplatePackageError(
        `Liquid render in “${file.path}” must reference a .liquid partial`,
      );
    refs.push(partialPath);
  }
  return refs;
}

function validatePartialGraph(templatePackage: TemplatePackage): void {
  const visiting = new Set<string>();
  const visitedDepth = new Map<string, number>();
  const visit = (filePath: string, depth: number) => {
    if (depth > MAX_PARTIAL_DEPTH)
      throw new TemplatePackageError(
        `Liquid partial nesting exceeds ${MAX_PARTIAL_DEPTH} levels`,
      );
    if (visiting.has(filePath))
      throw new TemplatePackageError(
        `Liquid partial cycle includes “${filePath}”`,
      );
    // A shared partial reached through a longer path must be checked again.
    if ((visitedDepth.get(filePath) ?? -1) >= depth) return;
    const file = findPackageFile(templatePackage, filePath);
    if (!file || file.encoding !== "utf8")
      throw new TemplatePackageError(
        `Liquid partial “${filePath}” is missing or not text`,
      );
    visiting.add(filePath);
    for (const ref of partialReferences(file)) visit(ref, depth + 1);
    visiting.delete(filePath);
    visitedDepth.set(filePath, depth);
  };
  for (const file of templatePackage.files) {
    if (file.encoding === "utf8") visit(file.path, 0);
  }
}

export function validatePackageReferences(
  templatePackage: TemplatePackage,
): void {
  for (const file of templatePackage.files) {
    if (file.encoding !== "utf8") continue;
    if (file.path.endsWith(".html") || file.path.endsWith(".htm"))
      validateHtmlReferences(templatePackage, file);
    if (file.path.endsWith(".css"))
      validateCssReferences(templatePackage, file);
  }
  validatePartialGraph(templatePackage);
}

export function templatePackageFromRevision(
  source: string | null,
  configurationJson: string,
): TemplatePackage {
  try {
    const config = JSON.parse(configurationJson) as {
      templatePackage?: TemplatePackage;
    };
    if (config.templatePackage)
      return validateTemplatePackage(config.templatePackage);
  } catch {
    throw new TemplatePackageError(
      "Saved template package configuration is invalid",
    );
  }
  if (source === null)
    throw new TemplatePackageError("HTML template source is missing");
  return packageFromSource(source);
}

export function revisionHasTemplatePackage(configurationJson: string): boolean {
  try {
    return Boolean(
      (JSON.parse(configurationJson) as { templatePackage?: unknown })
        .templatePackage,
    );
  } catch {
    return false;
  }
}

export function templatePackageConfiguration(
  templatePackage: TemplatePackage,
): string {
  return JSON.stringify({
    templatePackage: validateTemplatePackage(templatePackage),
  });
}

export function decodePackageFile(file: TemplatePackageFile): Uint8Array {
  return bytesFor(file);
}

/** ZIP encoding is only used for packages with more than the entry document. */
export function exportTemplatePackageZip(
  templatePackage: TemplatePackage,
): Uint8Array {
  const normalized = validateTemplatePackage(templatePackage);
  return zipSync(
    Object.fromEntries(
      normalized.files.map((file) => [file.path, decodePackageFile(file)]),
    ),
    { level: 6 },
  );
}

function assertZipCentralDirectory(bytes: Uint8Array): void {
  // fflate exposes streaming sizes, but not POSIX mode bits. Inspect central
  // directory records before extraction so a symlink cannot masquerade as a
  // normal package asset. This does not write any archive member to disk.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (
    let offset = bytes.length - 22;
    offset >= Math.max(0, bytes.length - 65_557);
    offset -= 1
  ) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0)
    throw new TemplatePackageError("Template ZIP has no central directory");
  const entries = view.getUint16(eocd + 10, true);
  const centralSize = view.getUint32(eocd + 12, true);
  let offset = view.getUint32(eocd + 16, true);
  if (
    entries === 0xffff ||
    centralSize === 0xffffffff ||
    offset === 0xffffffff
  ) {
    throw new TemplatePackageError("ZIP64 template archives are not supported");
  }
  const end = offset + centralSize;
  if (end > bytes.length)
    throw new TemplatePackageError(
      "Template ZIP central directory is truncated",
    );
  const paths = new Set<string>();
  let declaredTotal = 0;
  let declaredFiles = 0;
  for (let index = 0; index < entries; index += 1) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) {
      throw new TemplatePackageError(
        "Template ZIP central directory is invalid",
      );
    }
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const externalAttributes = view.getUint32(offset + 38, true);
    const originalSize = view.getUint32(offset + 24, true);
    const unixType = (externalAttributes >>> 16) & 0xf000;
    if (unixType === 0xa000)
      throw new TemplatePackageError(
        "Template ZIP cannot contain symbolic links",
      );
    const next = offset + 46 + nameLength + extraLength + commentLength;
    if (next > end)
      throw new TemplatePackageError(
        "Template ZIP central directory is truncated",
      );
    let name: string;
    try {
      name = textDecoder.decode(
        bytes.subarray(offset + 46, offset + 46 + nameLength),
      );
    } catch {
      throw new TemplatePackageError("Template ZIP has a non-UTF-8 filename");
    }
    const checked = name.endsWith("/") ? name.slice(0, -1) : name;
    if (!checked)
      throw new TemplatePackageError("Template ZIP contains an empty path");
    assertPath(checked);
    const key = checked.toLocaleLowerCase("en-US");
    if (paths.has(key))
      throw new TemplatePackageError(
        `Template ZIP contains duplicate file “${name}”`,
      );
    paths.add(key);
    if (!name.endsWith("/")) {
      declaredFiles += 1;
      if (declaredFiles > MAX_TEMPLATE_PACKAGE_FILES)
        throw new TemplatePackageError(
          `Template ZIP contains more than ${MAX_TEMPLATE_PACKAGE_FILES} files`,
        );
      if (!isImagePath(name) && originalSize > MAX_TEMPLATE_TEXT_FILE_BYTES)
        throw new TemplatePackageError(
          `Text file “${name}” exceeds the 200 KB limit`,
        );
      declaredTotal += originalSize;
      if (declaredTotal > MAX_TEMPLATE_PACKAGE_BYTES)
        throw new TemplatePackageError(
          "Template ZIP exceeds the 8 MiB decoded size limit",
        );
    }
    offset = next;
  }
}

export function importTemplatePackageZip(bytes: Uint8Array): TemplatePackage {
  if (bytes.length === 0 || bytes.length > MAX_TEMPLATE_ZIP_BYTES)
    throw new TemplatePackageError(
      "Template ZIP must be no larger than 10 MiB",
    );
  assertZipCentralDirectory(bytes);
  const extracted = new Map<string, Uint8Array>();
  let total = 0;
  const unzip = new Unzip((file) => {
    if (file.name.endsWith("/")) return;
    assertPath(file.name);
    if (extracted.has(file.name))
      throw new TemplatePackageError(
        `Template ZIP contains duplicate file “${file.name}”`,
      );
    if (extracted.size >= MAX_TEMPLATE_PACKAGE_FILES)
      throw new TemplatePackageError(
        `Template ZIP contains more than ${MAX_TEMPLATE_PACKAGE_FILES} files`,
      );
    if ((file.originalSize ?? 0) > MAX_TEMPLATE_PACKAGE_BYTES)
      throw new TemplatePackageError(
        `Template ZIP file “${file.name}” is too large`,
      );
    const chunks: Uint8Array[] = [];
    let size = 0;
    file.ondata = (error, chunk, final) => {
      if (error)
        throw new TemplatePackageError(
          `Template ZIP file “${file.name}” cannot be read`,
        );
      size += chunk.length;
      total += chunk.length;
      if (size > MAX_TEMPLATE_TEXT_FILE_BYTES && !isImagePath(file.name))
        throw new TemplatePackageError(
          `Text file “${file.name}” exceeds the 200 KB limit`,
        );
      if (total > MAX_TEMPLATE_PACKAGE_BYTES)
        throw new TemplatePackageError(
          "Template ZIP exceeds the 8 MiB decoded size limit",
        );
      chunks.push(chunk);
      if (final) {
        const output = new Uint8Array(size);
        let offset = 0;
        for (const part of chunks) {
          output.set(part, offset);
          offset += part.length;
        }
        extracted.set(file.name, output);
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  try {
    const chunkSize = 64 * 1024;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      unzip.push(
        bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize)),
        offset + chunkSize >= bytes.length,
      );
    }
  } catch (error) {
    if (error instanceof TemplatePackageError) throw error;
    throw new TemplatePackageError(
      "Template ZIP is invalid or uses an unsupported compression method",
    );
  }
  if (!extracted.size)
    throw new TemplatePackageError("Template ZIP has no files");
  const paths = [...extracted.keys()];
  let prefix = "";
  if (!extracted.has(TEMPLATE_PACKAGE_ENTRY)) {
    const firstParts = paths.map((filePath) => filePath.split("/")[0]!);
    if (
      firstParts.length &&
      firstParts.every((part) => part === firstParts[0]) &&
      extracted.has(`${firstParts[0]}/${TEMPLATE_PACKAGE_ENTRY}`)
    )
      prefix = `${firstParts[0]}/`;
    else
      throw new TemplatePackageError(
        "Template ZIP must contain index.html at its root (or inside one enclosing folder)",
      );
  }
  const files: TemplatePackageFile[] = paths.map((filePath) => {
    const relative = prefix ? filePath.slice(prefix.length) : filePath;
    if (!relative || relative.includes("/../"))
      throw new TemplatePackageError(
        "Template ZIP contains an invalid enclosing folder",
      );
    const data = extracted.get(filePath)!;
    if (isImagePath(relative))
      return {
        path: relative,
        content: Buffer.from(data).toString("base64"),
        encoding: "base64",
      };
    try {
      return {
        path: relative,
        content: textDecoder.decode(data),
        encoding: "utf8",
      };
    } catch {
      throw new TemplatePackageError(
        `Text file “${relative}” is not valid UTF-8`,
      );
    }
  });
  return validateTemplatePackage({
    version: 1,
    entry: TEMPLATE_PACKAGE_ENTRY,
    files,
  });
}
