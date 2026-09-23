import { javascriptLanguage } from "@codemirror/lang-javascript";
import type { SyntaxNode } from "@lezer/common";
import type { TemplatePackage } from "../src/domain/template-package.ts";
import { findLiquidOccurrences } from "../src/features/pdf-templates/template-workspace-state.ts";

export type DetectedPartyField = {
  party: "issuer" | "customer";
  key: string;
  label: string;
  section: "other";
};

const safeKey = (key: string) => /^[a-z][a-z0-9_]{0,63}$/.test(key) && !["constructor", "prototype", "__proto__"].includes(key);
const children = (node: SyntaxNode): SyntaxNode[] => {
  const result: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) result.push(child);
  return result;
};
const literal = (value: string): string | undefined => {
  // Field identifiers cannot contain escapes, quotes, or computed expressions.
  const match = value.match(/^(['"])([a-z][a-z0-9_]*)\1$/);
  return match?.[2];
};

/** Static hints only: never executes template code or guesses runtime-computed keys. */
export function detectTemplatePartyFields(pkg: TemplatePackage, engine: "react-pdf" | "gotenberg-html"): DetectedPartyField[] {
  const found = new Map<string, DetectedPartyField>();
  const add = (path: string[]) => {
    if (path[0] === "document") path = path.slice(1);
    const [party, field, key] = path;
    if ((party !== "issuer" && party !== "customer") || field !== "field" || !key || !safeKey(key)) return;
    found.set(`${party}.${key}`, { party, key, label: key.replaceAll("_", " ").replace(/^./, (char) => char.toUpperCase()), section: "other" });
  };
  if (engine === "react-pdf") {
    for (const file of pkg.files) if (file.encoding === "utf8" && /\.[jt]sx?$/i.test(file.path)) detectReact(file.content, add);
  } else detectLiquid(pkg, add);
  return [...found.values()].sort((a, b) => `${a.party}.${a.key}`.localeCompare(`${b.party}.${b.key}`));
}

function detectLiquid(pkg: TemplatePackage, add: (path: string[]) => void) {
  const files = pkg.files.filter((file) => file.encoding === "utf8" && /\.(html?|liquid)$/i.test(file.path));
  const queue = files.map((file) => ({ file, aliases: new Map<string, string>([["issuer", "issuer"], ["customer", "customer"]]) }));
  const visited = new Set<string>();
  const path = (value: string) => value.replace(/\[['"]([a-z][a-z0-9_]*)['"]\]/g, ".$1").split(".");
  // A package may render one partial with several different party arguments.
  for (let index = 0; index < queue.length && index < 500; index++) {
    const { file, aliases } = queue[index]!;
    const id = `${file.path}:${JSON.stringify([...aliases].sort())}`;
    if (visited.has(id)) continue;
    visited.add(id);
    for (const occurrence of findLiquidOccurrences({ ...pkg, files: [file] })) {
      const parts = path(occurrence.field);
      parts[0] = aliases.get(parts[0]!) ?? parts[0]!;
      add(parts);
    }
    const source = file.content.replace(/\{%[-~]?\s*(comment|raw)\s*[-~]?%\}[\s\S]*?\{%[-~]?\s*end\1\s*[-~]?%\}/g, "");
    const local = new Map(aliases);
    for (const tag of source.matchAll(/\{%[-~]?\s*([\s\S]*?)\s*[-~]?%\}/g)) {
      const assign = tag[1]!.match(/^assign\s+(\w+)\s*=\s*(\w+)\s*$/);
      if (assign) {
        const resolved = local.get(assign[2]!);
        if (resolved) local.set(assign[1]!, resolved); else local.delete(assign[1]!);
      }
      const render = tag[1]!.match(/^render\s+(['"])([^'"]+)\1([\s\S]*)$/);
      if (!render) continue;
      const target = files.find((candidate) => candidate.path === render[2]);
      if (!target) continue;
      const context = new Map<string, string>([["issuer", "issuer"], ["customer", "customer"]]);
      for (const arg of render[3]!.matchAll(/(?:^|,)\s*(\w+)\s*:\s*(\w+)\s*(?=,|$)/g)) {
        const resolved = local.get(arg[2]!);
        if (resolved) context.set(arg[1]!, resolved);
      }
      queue.push({ file: target, aliases: context });
    }
  }
}

type Ref = string[];
type Scope = { values: Map<string, Ref>; functions: Map<string, { node: SyntaxNode; scope: Scope }> };
const fork = (scope: Scope): Scope => ({ values: new Map(scope.values), functions: new Map(scope.functions) });

function detectReact(source: string, add: (path: string[]) => void) {
  const tree = javascriptLanguage.parser.configure({ dialect: "jsx ts" }).parse(source);
  const text = (node: SyntaxNode) => source.slice(node.from, node.to);
  const functionNode = (node: SyntaxNode) => ["FunctionDeclaration", "FunctionExpression", "ArrowFunction"].includes(node.name);
  function bind(pattern: SyntaxNode, value: Ref | undefined, scope: Scope) {
    if (pattern.name === "VariableDefinition") {
      if (value) scope.values.set(text(pattern), value);
      else if (text(pattern) !== "document") scope.values.delete(text(pattern));
    } else if (pattern.name === "ObjectPattern") {
      for (const property of children(pattern).filter((child) => child.name === "PatternProperty")) {
        const key = property.getChild("PropertyName");
        if (!key) continue;
        const target = children(property).find((child) => ["VariableDefinition", "ObjectPattern"].includes(child.name));
        const next = value ? [...value, text(key)] : text(key) === "document" ? ["document"] : undefined;
        if (target) bind(target, next, scope);
        else if (next) scope.values.set(text(key), next);
      }
    }
  }
  function parameters(node: SyntaxNode) {
    const list = node.getChild("ParamList");
    return list ? children(list).filter((child) => ["VariableDefinition", "ObjectPattern"].includes(child.name)) : children(node).filter((child) => child.name === "VariableDefinition");
  }
  function resultNode(node: SyntaxNode): SyntaxNode | undefined {
    const block = node.getChild("Block");
    if (!block) return node.lastChild ?? undefined;
    const statement = children(block).find((child) => child.name === "ReturnStatement");
    return statement ? children(statement).find((child) => child.name !== "return" && child.name !== ";") : undefined;
  }
  function resolve(node: SyntaxNode | undefined, scope: Scope, depth = 0): Ref | undefined {
    if (!node || depth > 12) return;
    if (node.name === "VariableName") return scope.values.get(text(node));
    if (node.name === "String") { const key = literal(text(node)); return key ? [key] : undefined; }
    if (node.name === "MemberExpression") {
      const parts = children(node), base = resolve(parts[0], scope, depth + 1);
      if (!base) return;
      const property = parts.find((child) => child.name === "PropertyName");
      if (property) return [...base, text(property)];
      const index = parts.findIndex((child) => child.name === "[");
      const key = index >= 0 ? resolve(parts[index + 1], scope, depth + 1) : undefined;
      return key?.length === 1 ? [...base, key[0]!] : undefined;
    }
    if (node.name === "CallExpression") {
      const parts = children(node), callee = parts[0];
      const fn = callee?.name === "VariableName" ? scope.functions.get(text(callee)) : undefined;
      if (!fn) return;
      const args = children(node.getChild("ArgList")!).filter((child) => !["(", ")", ","].includes(child.name));
      const local = fork(fn.scope);
      parameters(fn.node).forEach((parameter, index) => bind(parameter, resolve(args[index], scope, depth + 1), local));
      // Support small field-access helpers, including Classic's party/key wrappers.
      const body = fn.node.getChild("Block");
      if (body) for (const declaration of children(body).filter((child) => child.name === "VariableDeclaration")) declarationBindings(declaration, local, depth + 1);
      return resolve(resultNode(fn.node), local, depth + 1);
    }
    if (node.name === "ParenthesizedExpression" || node.name === "BinaryExpression") {
      const first = children(node).find((child) => !["(", ")"].includes(child.name));
      return resolve(first, scope, depth + 1);
    }
  }
  function declarationBindings(node: SyntaxNode, scope: Scope, depth = 0) {
    const parts = children(node);
    for (let index = 0; index < parts.length; index++) if (parts[index]!.name === "Equals") {
      const pattern = parts.slice(0, index).reverse().find((child) => ["VariableDefinition", "ObjectPattern"].includes(child.name));
      const value = parts[index + 1];
      if (!pattern) continue;
      if (value && functionNode(value) && pattern.name === "VariableDefinition") scope.functions.set(text(pattern), { node: value, scope });
      bind(pattern, resolve(value, scope, depth + 1), scope);
    }
  }
  function walk(node: SyntaxNode, scope: Scope, depth = 0) {
    if (depth > 150) return;
    if (node.name === "Script" || node.name === "Block") {
      const local = fork(scope);
      for (const child of children(node)) if (child.name === "FunctionDeclaration") {
        const name = child.getChild("VariableDefinition");
        if (name) local.functions.set(text(name), { node: child, scope: local });
      }
      for (const child of children(node)) walk(child, local, depth + 1);
      return;
    }
    if (functionNode(node)) {
      const local = fork(scope);
      for (const param of parameters(node)) bind(param, undefined, local);
      for (const child of children(node)) if (child.name !== "ParamList") walk(child, local, depth + 1);
      return;
    }
    if (node.name === "VariableDeclaration") declarationBindings(node, scope);
    if (node.name === "MemberExpression" || node.name === "CallExpression") {
      const ref = resolve(node, scope);
      if (ref) add(ref);
    }
    for (const child of children(node)) walk(child, scope, depth + 1);
  }
  walk(tree.topNode, { values: new Map([["document", ["document"]]]), functions: new Map() });
}
