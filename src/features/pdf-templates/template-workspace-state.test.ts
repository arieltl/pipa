import { expect, test } from "bun:test";
import {
  addWorkspaceFile,
  clampPanelState,
  deleteWorkspaceFile,
  findLiquidOccurrences,
  isWorkspaceDirty,
  renameWorkspaceFile,
  serialiseWorkspacePackage,
  type WorkspacePackage,
} from "./template-workspace-state.ts";

const base: WorkspacePackage = {
  version: 1,
  entry: "index.html",
  files: [
    { path: "index.html", content: "{{ invoice.number }}", encoding: "utf8" },
  ],
};

test("workspace file operations preserve entry and reject collisions", () => {
  const added = addWorkspaceFile(base, {
    path: " styles/main.css ",
    content: "",
    encoding: "utf8",
  });
  expect(added.files.map((file) => file.path)).toEqual([
    "index.html",
    "styles/main.css",
  ]);
  expect(() => renameWorkspaceFile(added, "index.html", "main.html")).toThrow();
  expect(() =>
    renameWorkspaceFile(added, "styles/main.css", "INDEX.HTML"),
  ).toThrow();
  expect(() => deleteWorkspaceFile(added, "index.html")).toThrow();
  expect(deleteWorkspaceFile(added, "styles/main.css")).toEqual(base);
});

test("dirty comparison is stable across file order", () => {
  const one = addWorkspaceFile(base, {
    path: "z.css",
    content: "x",
    encoding: "utf8",
  });
  const reordered = { ...one, files: [...one.files].reverse() };
  expect(serialiseWorkspacePackage(one)).toBe(
    serialiseWorkspacePackage(reordered),
  );
  expect(isWorkspaceDirty("A", one, "A", reordered)).toBe(false);
  expect(
    isWorkspaceDirty("A", one, "A", {
      ...one,
      files: one.files.map((f) =>
        f.path === "z.css" ? { ...f, content: "y" } : f,
      ),
    }),
  ).toBe(true);
});

test("field scanner only reports Liquid expressions with accurate locations", () => {
  const pkg: WorkspacePackage = {
    version: 1,
    entry: "index.html",
    files: [
      {
        path: "index.html",
        encoding: "utf8",
        content:
          "invoice.fake\n{#   {{ invoice.nope }}   #}\n{{ invoice.number }}\n{{ 'invoice.literal' }}\n{% raw %} {{ total.raw }} {% endraw %}\n{% for row in items %}{{ row.name }}{% endfor %}",
      },
    ],
  };
  expect(
    findLiquidOccurrences(pkg).map(({ field, line, column }) => [
      field,
      line,
      column,
    ]),
  ).toEqual([
    ["invoice.number", 3, 4],
    ["items", 6, 15],
    ["items[].name", 6, 26],
  ]);
});

test("field scanner maps assigned aliases and ignores render argument keys", () => {
  const pkg: WorkspacePackage = {
    version: 1,
    entry: "index.html",
    files: [
      {
        path: "index.html",
        encoding: "utf8",
        content:
          "{% assign bill = invoice %}{{ bill.number }} {{ customer['display_name'] }}{% render 'p.liquid', invoice: invoice, label: 'invoice.fake' %}",
      },
    ],
  };
  expect(findLiquidOccurrences(pkg).map((item) => item.field)).toEqual([
    "invoice",
    "invoice.number",
    "customer['display_name']",
    "invoice",
  ]);
});

test("field scanner preserves nested collection aliases and locates partial variables", () => {
  const content =
    "{% assign bill = invoice %}{% for person in customer.fields %}{% for row in items %}{{ row.name }}{% endfor %}{{ person.value }}{% endfor %}{{ bill.number }}{{ party.name | upcase }}{{ '😀' | append: invoice.number }}";
  const pkg: WorkspacePackage = {
    version: 1,
    entry: "index.html",
    files: [{ path: "index.html", encoding: "utf8", content }],
  };
  const refs = findLiquidOccurrences(pkg);
  expect(refs.map((item) => item.field)).toEqual([
    "invoice",
    "customer.fields",
    "items",
    "items[].name",
    "customer.fields[].value",
    "invoice.number",
    "party.name",
    "invoice.number",
  ]);
  for (const item of refs)
    expect(content.slice(item.from, item.to)).toMatch(
      /^(?:invoice|customer|items|row|person|bill|party)/,
    );
});

test("panel state clamps to preserve useful editor space", () => {
  expect(
    clampPanelState(
      {
        filesOpen: true,
        previewOpen: true,
        toolsOpen: true,
        filesWidth: 999,
        previewWidth: 999,
        toolsHeight: 999,
      },
      1024,
      700,
    ),
  ).toEqual({
    filesOpen: true,
    previewOpen: true,
    toolsOpen: true,
    filesWidth: 320,
    previewWidth: 320,
    toolsHeight: 380,
  });
});
