/** @jsxImportSource react */
import React from "react";
import {
  Document,
  Image,
  Link,
  Page,
  Text,
  View,
  renderToBuffer,
} from "@react-pdf/renderer";
import { newQuickJSWASMModuleFromVariant } from "quickjs-emscripten";
import RELEASE_SYNC from "@jitl/quickjs-singlefile-cjs-release-sync";
import {
  decodePackageFile,
  findPackageFile,
  templatePackageEngine,
  validateTemplatePackage,
  type TemplatePackage,
} from "../domain/template-package.ts";
import type { InvoiceDocumentModel } from "./document-model.ts";
import { PdfRendererUnavailableError } from "./renderer.ts";
export { classicEditableReactSource } from "./classic-react-template-source.ts";

const MAX_NODES = 2_000;
const MAX_DEPTH = 48;
const MAX_TEXT = 100_000;
const MAX_PDF_BYTES = 16 * 1024 * 1024;
const quickJs = newQuickJSWASMModuleFromVariant(RELEASE_SYNC);
const primitives = { Document, Page, View, Text, Link, Image } as const;
type PrimitiveName = keyof typeof primitives;
const supportedImports = new Set([
  "react",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "@react-pdf/renderer",
]);

export class ReactTemplateError extends PdfRendererUnavailableError {}

/** User code runs only inside QuickJS; only validated JSON crosses to React PDF. */
export async function renderReactTemplatePackage(
  input: TemplatePackage,
  document: InvoiceDocumentModel,
): Promise<Buffer> {
  const templatePackage = validateTemplatePackage(input);
  if (templatePackageEngine(templatePackage) !== "react-pdf")
    throw new ReactTemplateError(
      "React PDF requires an index.tsx package entry",
    );
  let serialized: unknown;
  try {
    const modules = compiledModules(templatePackage);
    const module = await quickJs;
    const runtime = module.newRuntime();
    runtime.setMemoryLimit(16 * 1024 * 1024);
    runtime.setMaxStackSize(512 * 1024);
    const deadline = Date.now() + 1_000;
    runtime.setInterruptHandler(() => Date.now() > deadline);
    const context = runtime.newContext();
    try {
      runtime.setModuleLoader(
        (name) => {
          const source = modules.get(name);
          if (source === undefined)
            throw new Error(`Module is not allowed: ${name}`);
          return source;
        },
        (base, request) => resolveModule(modules, base, request),
      );
      context.unwrapResult(context.evalCode(sandboxPrelude)).dispose();
      const driver = `import component from './index.tsx';
        globalThis.__pipaTemplateResult = JSON.stringify(__normalise(component({document:${JSON.stringify(document)}}), 0, {nodes:0}));`;
      context
        .unwrapResult(
          context.evalCode(driver, "template-entry.mjs", { type: "module" }),
        )
        .dispose();
      const output = context.unwrapResult(
        context.evalCode("globalThis.__pipaTemplateResult"),
      );
      try {
        const json = context.getString(output);
        if (json.length > 2 * 1024 * 1024)
          throw new ReactTemplateError(
            "React PDF document output exceeds 2 MiB",
          );
        serialized = JSON.parse(json);
      } finally {
        output.dispose();
      }
    } finally {
      context.dispose();
      runtime.dispose();
    }
    const tree = validateTree(serialized, templatePackage);
    const output = await renderToBuffer(
      React.createElement(
        Document,
        tree.props,
        ...tree.children.map(toTrustedElement),
      ),
    );
    if (output.length > MAX_PDF_BYTES)
      throw new ReactTemplateError("Rendered PDF exceeds the 16 MiB limit");
    return output;
  } catch (error) {
    if (error instanceof ReactTemplateError) throw error;
    const message =
      error instanceof Error ? error.message : "Template execution failed";
    throw new ReactTemplateError(
      `React PDF template failed: ${message.includes("interrupted") ? "execution exceeded its time limit" : message}`,
    );
  }
}

function compiledModules(
  templatePackage: TemplatePackage,
): Map<string, string> {
  const modules = new Map<string, string>();
  for (const file of templatePackage.files) {
    if (file.encoding === "base64") {
      modules.set(file.path, `export default ${JSON.stringify(file.path)};`);
      continue;
    }
    if (!/\.[cm]?[jt]sx?$/i.test(file.path)) continue;
    try {
      const loader = /\.tsx$/i.test(file.path)
        ? "tsx"
        : /\.jsx$/i.test(file.path)
          ? "jsx"
          : /\.[cm]?ts$/i.test(file.path)
            ? "ts"
            : "js";
      const transpiler = new Bun.Transpiler({
        loader,
        tsconfig: {
          compilerOptions: {
            jsx: "react",
            jsxFactory: "__createElement",
            jsxFragmentFactory: "__Fragment",
          },
        },
      });
      modules.set(file.path, transpiler.transformSync(file.content));
    } catch (error) {
      throw new ReactTemplateError(
        `Cannot compile ${file.path}: ${error instanceof Error ? error.message : "invalid source"}`,
      );
    }
  }
  modules.set(
    "react",
    "export const createElement=globalThis.__createElement; export const Fragment=globalThis.__Fragment; export default {createElement,Fragment};",
  );
  modules.set(
    "react/jsx-runtime",
    "export const jsx=globalThis.__jsx; export const jsxs=globalThis.__jsx; export const Fragment=globalThis.__Fragment;",
  );
  modules.set(
    "react/jsx-dev-runtime",
    "export const jsxDEV=globalThis.__jsx; export const Fragment=globalThis.__Fragment;",
  );
  modules.set(
    "@react-pdf/renderer",
    'export const Document="Document", Page="Page", View="View", Text="Text", Link="Link", Image="Image"; export const StyleSheet={create:(value)=>value};',
  );
  return modules;
}

function resolveModule(
  modules: Map<string, string>,
  base: string,
  request: string,
): string {
  if (supportedImports.has(request)) return request;
  if (!request.startsWith("./") && !request.startsWith("../"))
    throw new Error(`Module is not allowed: ${request}`);
  const parts = base.split("/");
  parts.pop();
  for (const part of request.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length)
        throw new Error("Module path escapes the template package");
      parts.pop();
    } else parts.push(part);
  }
  const raw = parts.join("/");
  for (const candidate of [
    raw,
    ...[".tsx", ".ts", ".jsx", ".js"].flatMap((suffix) => [
      raw + suffix,
      raw + "/index" + suffix,
    ]),
  ])
    if (modules.has(candidate)) return candidate;
  throw new Error(`Module not found: ${request}`);
}

// This is static interpreter support code, executed inside the same isolated
// runtime as the template. Host-side validation remains authoritative even if
// a template replaces these helpers or forges its output directly.
const sandboxPrelude = `"use strict";
globalThis.__Fragment = "Fragment";
globalThis.__createElement = function(type, props, ...children) {
  return { type, props: props || {}, children: children.length ? children : (props && props.children !== undefined ? [props.children] : []) };
};
globalThis.__jsx = function(type, props, key) { return __createElement(type, Object.assign({}, props, {key})); };
globalThis.__normalise = function(value, depth, state) {
  if (depth > 48 || ++state.nodes > 2000) throw Error("Document exceeds structural limits");
  if (value === null || value === undefined || typeof value === "boolean") return [];
  if (Array.isArray(value)) return value.flatMap(v => {
    const result = __normalise(v, depth + 1, state);
    return Array.isArray(result) ? result : [result];
  });
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value !== "object") throw Error("Unsupported element value");
  if (typeof value.type === "function") return __normalise(value.type(Object.assign({}, value.props, {children: value.children})), depth + 1, state);
  if (value.type === "Fragment") return __normalise(value.children || [], depth + 1, state);
  if (typeof value.type !== "string") throw Error("Unsupported element type");
  const props = {};
  for (const [key, item] of Object.entries(value.props || {})) {
    if (key === "children" || key === "key") continue;
    if (typeof item === "function") throw Error("Callback props are not supported: " + key);
    props[key] = item;
  }
  return {type: value.type, props, children: __normalise(value.children || [], depth + 1, state)};
};`;

type Tree = {
  type: PrimitiveName;
  props: Record<string, unknown>;
  children: Array<Tree | string>;
};
function validateTree(input: unknown, templatePackage: TemplatePackage): Tree {
  let nodes = 0,
    text = 0,
    pages = 0;
  const visit = (
    value: unknown,
    depth: number,
    parent?: PrimitiveName,
  ): Tree | string => {
    if (depth > MAX_DEPTH || ++nodes > MAX_NODES)
      throw new ReactTemplateError(
        "React PDF document exceeds structural limits",
      );
    if (typeof value === "string") {
      text += value.length;
      if (text > MAX_TEXT)
        throw new ReactTemplateError(
          "React PDF document contains too much text",
        );
      if (parent !== "Text" && parent !== "Link")
        throw new ReactTemplateError(
          "Place text inside a Text or Link component",
        );
      return value;
    }
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new ReactTemplateError(
        "Template returned an invalid document tree",
      );
    const raw = value as {
      type?: unknown;
      props?: unknown;
      children?: unknown;
    };
    if (typeof raw.type !== "string" || !Object.hasOwn(primitives, raw.type))
      throw new ReactTemplateError(
        "Template used an unsupported React PDF component",
      );
    const type = raw.type as PrimitiveName;
    if (
      (parent === "Document" && type !== "Page") ||
      (type === "Page" && parent !== "Document") ||
      (type === "Document" && parent)
    )
      throw new ReactTemplateError(
        "Document must contain Pages; Pages cannot be nested",
      );
    if (type === "Page" && ++pages > 100)
      throw new ReactTemplateError("Template exceeds 100 explicit pages");
    const props = sanitizeProps(type, raw.props, templatePackage);
    if (!Array.isArray(raw.children))
      throw new ReactTemplateError("Template returned invalid children");
    return {
      type,
      props,
      children: raw.children.map((child) => visit(child, depth + 1, type)),
    };
  };
  const root = visit(input, 0);
  if (typeof root === "string" || root.type !== "Document" || !pages)
    throw new ReactTemplateError(
      "Template must return a Document with at least one Page",
    );
  return root;
}

function sanitizeProps(
  type: PrimitiveName,
  raw: unknown,
  templatePackage: TemplatePackage,
): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const allowed = new Set([
    "style",
    "size",
    "orientation",
    "wrap",
    "break",
    "fixed",
    "title",
    "author",
    "subject",
    "keywords",
    "creator",
    "producer",
    "language",
    "debug",
    "src",
    "source",
    "href",
    "id",
    "minPresenceAhead",
    "orphans",
    "widows",
  ]);
  const props: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (key === "key" || key === "children") continue;
    if (!allowed.has(key))
      throw new ReactTemplateError(`Unsupported ${type} property: ${key}`);
    if ((key === "src" || key === "source") && type === "Image") {
      props.src = imageSource(value, templatePackage);
      continue;
    }
    if (key === "href" || key === "src") {
      if (
        type !== "Link" ||
        typeof value !== "string" ||
        !/^(?:https?:\/\/|mailto:|#)/i.test(value) ||
        value.length > 2048
      )
        throw new ReactTemplateError(
          "Links must use HTTP(S), mailto, or document anchors",
        );
      props.src = value;
      continue;
    }
    if (key === "source")
      throw new ReactTemplateError("Only Image may use source");
    if (key === "style") {
      props.style = cleanStyle(value, 0, type === "Page");
      continue;
    }
    if (key === "size") {
      props.size = pageSize(value);
      continue;
    }
    if (
      typeof value === "number" &&
      (!Number.isFinite(value) || Math.abs(value) > 10000)
    )
      throw new ReactTemplateError(`Invalid numeric property: ${key}`);
    if (typeof value === "string" && value.length > 2048)
      throw new ReactTemplateError(`Property is too long: ${key}`);
    if (!["string", "number", "boolean"].includes(typeof value))
      throw new ReactTemplateError(`Invalid ${type} property: ${key}`);
    props[key] = value;
  }
  return props;
}

function pageSize(value: unknown): unknown {
  if (
    typeof value === "string" &&
    /^(?:A[0-6]|B[0-6]|C[0-6]|RA[0-4]|SRA[0-4]|EXECUTIVE|FOLIO|LEGAL|LETTER|TABLOID)$/i.test(
      value,
    )
  )
    return value.toUpperCase();
  const dimensions = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? [
          (value as Record<string, unknown>).width,
          (value as Record<string, unknown>).height,
        ]
      : [];
  if (
    dimensions.length === 2 &&
    dimensions.every(
      (number) =>
        typeof number === "number" &&
        Number.isFinite(number) &&
        number >= 144 &&
        number <= 14400,
    )
  )
    return dimensions;
  throw new ReactTemplateError(
    "Use a standard page size or two dimensions between 144 and 14,400 points",
  );
}

function cleanStyle(value: unknown, depth: number, page: boolean): unknown {
  if (depth > 12) throw new ReactTemplateError("Style nesting is too deep");
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Math.abs(value) > 14400)
      throw new ReactTemplateError(
        "Style number is outside the supported range",
      );
    return value;
  }
  if (typeof value === "string") {
    if (value.length > 500 || /(?:url\s*\(|https?:|file:)/i.test(value))
      throw new ReactTemplateError("Unsupported style value");
    for (const match of value.matchAll(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi))
      if (Math.abs(Number(match[0])) > 14400 && !/^#[a-f\d]+$/i.test(value))
        throw new ReactTemplateError(
          "Style number is outside the supported range",
        );
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 100)
      throw new ReactTemplateError("Too many style entries");
    return value.map((item) => cleanStyle(item, depth + 1, page));
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length > 200)
      throw new ReactTemplateError("Too many style properties");
    return Object.fromEntries(
      entries.map(([key, item]) => {
        if (["__proto__", "constructor", "prototype"].includes(key))
          throw new ReactTemplateError("Invalid style property");
        if (
          page &&
          ["width", "height", "maxHeight", "maxWidth"].includes(key) &&
          (typeof item !== "number" || item < 144)
        )
          throw new ReactTemplateError(
            "Page dimensions must be at least 144 points",
          );
        return [key, cleanStyle(item, depth + 1, page)];
      }),
    );
  }
  throw new ReactTemplateError("Style contains an unsupported value");
}

function imageSource(value: unknown, templatePackage: TemplatePackage): string {
  if (typeof value !== "string")
    throw new ReactTemplateError(
      "Image source must be a local PNG or JPEG package path",
    );
  const path = value.replace(/^\.\//, "");
  const file = findPackageFile(templatePackage, path);
  if (!file || file.encoding !== "base64" || !/\.(?:png|jpe?g)$/i.test(path))
    throw new ReactTemplateError(
      "React PDF Image requires a PNG or JPEG file in this package",
    );
  const bytes = Buffer.from(decodePackageFile(file));
  const mime = /\.png$/i.test(path) ? "png" : "jpeg";
  // Reject oversized decoded images before React PDF allocates their pixels.
  if (mime === "png") {
    if (bytes.length < 24)
      throw new ReactTemplateError("PNG image is incomplete");
    const width = bytes.readUInt32BE(16),
      height = bytes.readUInt32BE(20);
    if (!width || !height || width * height > 16_000_000)
      throw new ReactTemplateError("Image exceeds 16 million pixels");
  }
  return `data:image/${mime};base64,${bytes.toString("base64")}`;
}

function toTrustedElement(tree: Tree | string): React.ReactNode {
  if (typeof tree === "string") return tree;
  return React.createElement(
    primitives[tree.type] as React.ElementType,
    tree.props,
    ...tree.children.map(toTrustedElement),
  );
}
