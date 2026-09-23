import type {
  TemplatePackage,
  TemplatePackageFile,
} from "../../domain/template-package.ts";
export type WorkspaceFile = TemplatePackageFile;
export type WorkspacePackage = TemplatePackage;

export function normaliseWorkspacePackage(
  input: WorkspacePackage,
): WorkspacePackage {
  const entry = normalisePath(input.entry);
  if (entry !== "index.html" && entry !== "index.tsx")
    throw new Error("Template entry must be index.html or index.tsx.");
  const files = [...input.files]
    .map((file) => ({ ...file, path: normalisePath(file.path) }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { version: 1, entry, files };
}

export function normalisePath(value: string): string {
  const path = value
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\.\//, "")
    .replace(/\/{2,}/g, "/");
  if (
    !path ||
    path.startsWith("/") ||
    path.endsWith("/") ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error(
      "Use a relative file path without empty, . or .. segments.",
    );
  }
  return path;
}

export function isEditableTextFile(file: WorkspaceFile): boolean {
  return file.encoding === "utf8";
}

export function addWorkspaceFile(
  pkg: WorkspacePackage,
  file: WorkspaceFile,
): WorkspacePackage {
  const path = normalisePath(file.path);
  if (pkg.files.some((item) => item.path.toLowerCase() === path.toLowerCase()))
    throw new Error("A file with that path already exists.");
  return normaliseWorkspacePackage({
    ...pkg,
    files: [...pkg.files, { ...file, path }],
  });
}

export function renameWorkspaceFile(
  pkg: WorkspacePackage,
  from: string,
  to: string,
): WorkspacePackage {
  if (from === pkg.entry)
    throw new Error("The entry document cannot be renamed.");
  const path = normalisePath(to);
  if (
    pkg.files.some(
      (item) =>
        item.path !== from && item.path.toLowerCase() === path.toLowerCase(),
    )
  )
    throw new Error("A file with that path already exists.");
  if (!pkg.files.some((item) => item.path === from))
    throw new Error("File not found.");
  return normaliseWorkspacePackage({
    ...pkg,
    files: pkg.files.map((file) =>
      file.path === from ? { ...file, path } : file,
    ),
  });
}

export function deleteWorkspaceFile(
  pkg: WorkspacePackage,
  path: string,
): WorkspacePackage {
  if (path === pkg.entry)
    throw new Error("The entry document cannot be deleted.");
  return { ...pkg, files: pkg.files.filter((file) => file.path !== path) };
}

export function updateWorkspaceFile(
  pkg: WorkspacePackage,
  path: string,
  content: string,
): WorkspacePackage {
  return {
    ...pkg,
    files: pkg.files.map((file) =>
      file.path === path ? { ...file, content } : file,
    ),
  };
}

export function serialiseWorkspacePackage(pkg: WorkspacePackage): string {
  return JSON.stringify(normaliseWorkspacePackage(pkg));
}

export function isWorkspaceDirty(
  initialName: string,
  initialPackage: WorkspacePackage,
  name: string,
  pkg: WorkspacePackage,
): boolean {
  return (
    initialName !== name ||
    serialiseWorkspacePackage(initialPackage) !== serialiseWorkspacePackage(pkg)
  );
}

export type LiquidOccurrence = {
  path: string;
  field: string;
  from: number;
  to: number;
  line: number;
  column: number;
};

export type ReactOccurrence = LiquidOccurrence;

/** Finds document-model references in stored React PDF source. This is a small
 * source navigator rather than a TypeScript parser: strings and comments are
 * masked, and only explicit `document.*` references plus map callback aliases
 * are accepted. */
export function findReactOccurrences(pkg: WorkspacePackage): ReactOccurrence[] {
  const occurrences: ReactOccurrence[] = [];
  for (const file of pkg.files.filter(
    (candidate) =>
      isEditableTextFile(candidate) && /\.(?:[jt]sx?)$/i.test(candidate.path),
  )) {
    const masked = maskJavaScriptTrivia(file.content);
    const aliases: Array<{
      name: string;
      canonicalRoot: string;
      from: number;
      to: number;
    }> = [];
    for (const match of masked.matchAll(
      /\bdocument\.([A-Za-z_]\w*(?:\??\.[A-Za-z_]\w*)*)\??\.map\s*\(\s*(?:\(\s*)?([A-Za-z_]\w*)\b/g,
    )) {
      const mapOffset = match[0].lastIndexOf(".map"),
        open = masked.indexOf("(", match.index + mapOffset),
        close = matchingDelimiter(masked, open, "(", ")");
      if (open >= 0 && close > open)
        aliases.push({
          name: match[2]!,
          canonicalRoot: `document.${match[1]!.replaceAll("?.", ".")}[]`,
          from: match.index + match[0].length,
          to: close,
        });
    }

    const candidates: Array<{ raw: string; canonical: string; from: number }> =
      [];
    for (const match of masked.matchAll(
      /\bdocument\.[A-Za-z_]\w*(?:\??\.[A-Za-z_]\w*)*/g,
    )) {
      // The collection expression in `.map(...)` is useful by itself, while
      // `.map` is an Array method and not part of the document model.
      const raw = match[0].replace(/\??\.map$/, "");
      candidates.push({
        raw,
        canonical: raw.replaceAll("?.", "."),
        from: match.index,
      });
    }
    for (const { name: alias, canonicalRoot, from, to } of aliases) {
      const pattern = new RegExp(
        `\\b${escapeRegExp(alias)}\\.[A-Za-z_]\\w*(?:\\.[A-Za-z_]\\w*)*`,
        "g",
      );
      for (const match of masked.slice(from, to).matchAll(pattern)) {
        candidates.push({
          raw: match[0],
          canonical: canonicalRoot + match[0].slice(alias.length),
          from: from + match.index,
        });
      }
    }
    candidates.sort((a, b) => a.from - b.from || b.raw.length - a.raw.length);
    for (const candidate of candidates) {
      if (
        occurrences.some(
          (item) => item.path === file.path && item.from === candidate.from,
        )
      )
        continue;
      const before = file.content.slice(0, candidate.from);
      const lastBreak = before.lastIndexOf("\n");
      occurrences.push({
        path: file.path,
        field: candidate.canonical,
        from: candidate.from,
        to: candidate.from + candidate.raw.length,
        line: before.split("\n").length,
        column: candidate.from - lastBreak,
      });
    }
  }
  return occurrences;
}

function matchingDelimiter(
  source: string,
  start: number,
  opening: string,
  closing: string,
): number {
  let depth = 0;
  for (let index = start; index < source.length; index++) {
    if (source[index] === opening) depth++;
    else if (source[index] === closing && --depth === 0) return index;
  }
  return -1;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function maskJavaScriptTrivia(source: string): string {
  const result = source.split("");
  let state: "code" | "single" | "double" | "template" | "line" | "block" =
    "code";
  let escaped = false;
  const templateExpressionDepth: number[] = [];
  for (let index = 0; index < source.length; index++) {
    const char = source[index]!,
      next = source[index + 1];
    if (state === "line") {
      if (char === "\n") state = "code";
      else result[index] = " ";
      continue;
    }
    if (state === "block") {
      result[index] = char === "\n" ? "\n" : " ";
      if (char === "*" && next === "/") {
        result[++index] = " ";
        state = "code";
      }
      continue;
    }
    if (state === "single" || state === "double") {
      result[index] = char === "\n" ? "\n" : " ";
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (
        (state === "single" && char === "'") ||
        (state === "double" && char === '"')
      )
        state = "code";
      continue;
    }
    if (state === "template") {
      result[index] = char === "\n" ? "\n" : " ";
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "`") state = "code";
      else if (char === "$" && next === "{") {
        result[index] = result[index + 1] = " ";
        index++;
        templateExpressionDepth.push(1);
        state = "code";
      }
      continue;
    }
    if (char === "/" && next === "/") {
      result[index] = result[++index] = " ";
      state = "line";
      continue;
    }
    if (char === "/" && next === "*") {
      result[index] = result[++index] = " ";
      state = "block";
      continue;
    }
    if (char === "'") {
      result[index] = " ";
      state = "single";
      continue;
    }
    if (char === '"') {
      result[index] = " ";
      state = "double";
      continue;
    }
    if (char === "`") {
      result[index] = " ";
      state = "template";
      continue;
    }
    if (templateExpressionDepth.length) {
      const depthIndex = templateExpressionDepth.length - 1;
      if (char === "{")
        templateExpressionDepth[depthIndex] =
          templateExpressionDepth[depthIndex]! + 1;
      else if (char === "}") {
        templateExpressionDepth[depthIndex] =
          templateExpressionDepth[depthIndex]! - 1;
        if (templateExpressionDepth[depthIndex] === 0) {
          templateExpressionDepth.pop();
          result[index] = " ";
          state = "template";
        }
      }
    }
  }
  return result.join("");
}

/** A deliberately conservative scanner: only output/tag expressions are scanned,
 * so field-looking text in HTML, CSS and Liquid comments is never reported. */
export function findLiquidOccurrences(
  pkg: WorkspacePackage,
): LiquidOccurrence[] {
  const occurrences: LiquidOccurrence[] = [];
  for (const file of pkg.files.filter(isEditableTextFile)) {
    const aliases = new Map<string, string>();
    const loopScopes: Array<{ name: string; previous: string | undefined }> =
      [];
    const ignored: Array<[number, number]> = [];
    for (const match of file.content.matchAll(
      /\{%[-~]?\s*(?:comment|raw)\s*[-~]?%\}[\s\S]*?\{%[-~]?\s*end(?:comment|raw)\s*[-~]?%\}|\{#[\s\S]*?#\}/gi,
    ))
      ignored.push([match.index, match.index + match[0].length]);
    for (const liquid of file.content.matchAll(
      /\{\{[-~]?([\s\S]*?)[-~]?\}\}|\{%[-~]?([\s\S]*?)[-~]?%\}/g,
    )) {
      const base = liquid.index;
      if (ignored.some(([from, to]) => base >= from && base < to)) continue;
      const expression = liquid[1] ?? liquid[2] ?? "",
        expressionOffset = liquid[0].indexOf(expression),
        tag = liquid[2] !== undefined;
      const masked = maskQuoted(expression);
      const forMatch = tag
        ? masked.match(/^\s*for\s+([A-Za-z_]\w*)\s+in\s+([^\s,]+)/)
        : null;
      const assignMatch = tag
        ? masked.match(/^\s*assign\s+([A-Za-z_]\w*)\s*=\s*([^\s|,]+)/)
        : null;
      const declaration = forMatch?.[1] ?? assignMatch?.[1];
      const variablePattern =
        /\b[A-Za-z_]\w*(?:\.[A-Za-z_][\w-]*|\[['"][^'"\]]+['"]\])*/g;
      for (const field of masked.matchAll(variablePattern)) {
        const raw = expression.slice(
          field.index,
          field.index + field[0].length,
        );
        const root = raw.match(/^[A-Za-z_]\w*/)?.[0] ?? raw;
        if (
          root === declaration ||
          liquidKeyword(root) ||
          (tag && isNamedArgumentKey(masked, field.index, field[0].length))
        )
          continue;
        if (
          (tag && field.index === masked.search(/\S/)) ||
          /\|\s*$/.test(masked.slice(0, field.index))
        )
          continue;
        const canonicalRoot = aliases.get(root) ?? root;
        const canonical = canonicalRoot + raw.slice(root.length);
        const from = base + expressionOffset + field.index;
        const before = file.content.slice(0, from);
        const line = before.split("\n").length;
        const lastBreak = before.lastIndexOf("\n");
        occurrences.push({
          path: file.path,
          field: canonical,
          from,
          to: from + raw.length,
          line,
          column: from - lastBreak,
        });
      }
      if (forMatch) {
        const sourceRoot = forMatch[2]!.match(/^[A-Za-z_]\w*/)?.[0]!;
        const resolved = aliases.get(sourceRoot) ?? sourceRoot;
        loopScopes.push({
          name: forMatch[1]!,
          previous: aliases.get(forMatch[1]!),
        });
        aliases.set(
          forMatch[1]!,
          `${resolved}${forMatch[2]!.slice(sourceRoot.length)}[]`,
        );
      }
      if (assignMatch) {
        const sourceRoot = assignMatch[2]!.match(/^[A-Za-z_]\w*/)?.[0]!;
        const resolved =
          aliases.get(sourceRoot) ??
          (knownRoot(sourceRoot) ? sourceRoot : undefined);
        if (resolved)
          aliases.set(
            assignMatch[1]!,
            resolved + assignMatch[2]!.slice(sourceRoot.length),
          );
      }
      if (tag && /^\s*endfor\b/.test(masked)) {
        const scope = loopScopes.pop();
        if (scope) {
          if (scope.previous === undefined) aliases.delete(scope.name);
          else aliases.set(scope.name, scope.previous);
        }
      }
    }
  }
  return occurrences;
}

function maskQuoted(value: string): string {
  let quote = "",
    escaped = false,
    preserve = false;
  return value
    .split("")
    .map((char, index) => {
      if (escaped) {
        escaped = false;
        return preserve ? char : " ";
      }
      if (char === "\\" && quote) {
        escaped = true;
        return preserve ? char : " ";
      }
      if (quote) {
        if (char === quote) quote = "";
        return preserve ? char : " ";
      }
      if (char === "'" || char === '"') {
        quote = char;
        preserve = value.slice(0, index).trimEnd().endsWith("[");
        return preserve ? char : " ";
      }
      return char;
    })
    .join("");
}
function knownRoot(value: string): boolean {
  return [
    "issuer",
    "customer",
    "client",
    "invoice",
    "total",
    "items",
    "item",
    "notaFiscal",
    "records",
    "record",
    "field",
  ].includes(value);
}
function liquidKeyword(value: string): boolean {
  return [
    "for",
    "in",
    "assign",
    "render",
    "if",
    "elsif",
    "else",
    "endif",
    "endfor",
    "true",
    "false",
    "nil",
    "blank",
    "empty",
    "and",
    "or",
    "contains",
  ].includes(value);
}
function isNamedArgumentKey(
  value: string,
  index: number,
  length: number,
): boolean {
  return /^\s*:/.test(value.slice(index + length));
}

export type PanelState = {
  filesOpen: boolean;
  previewOpen: boolean;
  toolsOpen: boolean;
  filesWidth: number;
  previewWidth: number;
  toolsHeight: number;
};
export const defaultPanelState: PanelState = {
  filesOpen: true,
  previewOpen: true,
  toolsOpen: true,
  filesWidth: 220,
  previewWidth: 480,
  toolsHeight: 230,
};

export function clampPanelState(
  state: PanelState,
  viewportWidth: number,
  viewportHeight: number,
): PanelState {
  const available = Math.max(700, viewportWidth);
  const filesWidth = Math.min(
    Math.max(state.filesWidth, 170),
    Math.min(320, available - 650),
  );
  const previewWidth = Math.min(
    Math.max(state.previewWidth, 320),
    Math.max(320, available - filesWidth - 420),
  );
  return {
    ...state,
    filesWidth,
    previewWidth,
    toolsHeight: Math.min(
      Math.max(state.toolsHeight, 140),
      Math.max(140, viewportHeight - 320),
    ),
  };
}
