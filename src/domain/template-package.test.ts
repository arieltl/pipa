import { describe, expect, test } from "bun:test";
import {
  exportTemplatePackageZip,
  importTemplatePackageZip,
  packageFromSource,
  TemplatePackageError,
  validateTemplatePackage,
  MAX_TEMPLATE_TEXT_FILE_BYTES,
} from "./template-package.ts";
import { renderLiquidHtmlPackage } from "../pdf/html/liquid-engine.ts";
import { sampleInvoiceDocument } from "../pdf/sample-document.ts";
import { strToU8, zipSync } from "fflate";

const html = (body: string, head = "") =>
  `<!doctype html><html><head><title>Invoice</title>${head}</head><body>${body}</body></html>`;

describe("template packages", () => {
  test("enforces nesting limits when shared partials are reached by a longer path", () => {
    const files = Array.from({ length: 18 }, (_, index) => ({
      path: `p${String(index).padStart(2, "0")}.liquid`,
      content: index === 0 ? "Leaf" : `{% render 'p${String(index - 1).padStart(2, "0")}.liquid' %}`,
      encoding: "utf8",
    }));
    expect(() => validateTemplatePackage({
      version: 1, entry: "index.html",
      files: [{ path: "index.html", content: html("Invoice"), encoding: "utf8" }, ...files],
    })).toThrow(/nesting exceeds/);
  });

  test("rejects ZIP symlinks, traversal, case collisions and oversized inflated text", () => {
    const entry = strToU8(html("Hello"));
    for (const archive of [
      zipSync({ "../index.html": entry }),
      zipSync({ "index.html": entry, "INDEX.HTML": entry }),
      zipSync({ "index.html": [entry, { os: 3, attrs: (0xa1ff << 16) >>> 0 }] }),
      zipSync({ "index.html": entry, "huge.css": strToU8(" ".repeat(MAX_TEMPLATE_TEXT_FILE_BYTES + 1)) }),
    ]) expect(() => importTemplatePackageZip(archive)).toThrow(TemplatePackageError);
  });

  test("rejects disguised image bytes and validates resource URLs emitted by Liquid", () => {
    expect(() => validateTemplatePackage({ version: 1, entry: "index.html", files: [
      { path: "index.html", content: html("Invoice"), encoding: "utf8" },
      { path: "logo.png", content: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString("base64"), encoding: "base64" },
    ] })).toThrow(TemplatePackageError);
    const pkg = { version: 1 as const, entry: "index.html" as const, files: [
      { path: "index.html", content: html("{% render 'image.liquid', url: customer.name %}"), encoding: "utf8" as const },
      { path: "image.liquid", content: '<img src="{{ url }}">', encoding: "utf8" as const },
    ] };
    expect(() => renderLiquidHtmlPackage(pkg, { ...sampleInvoiceDocument, customer: { ...sampleInvoiceDocument.customer, name: "https://example.test/logo.png" } })).toThrow("External or absolute");
  });

  test("round-trips a package with CSS, an image, and an unused file through ZIP", () => {
    const templatePackage = validateTemplatePackage({
      version: 1,
      entry: "index.html",
      files: [
        {
          path: "images/logo.png",
          content: "iVBORw0KGgoAAAANSUhEUg==",
          encoding: "base64",
        },
        {
          path: "styles/invoice.css",
          content: ".logo { background: url('../images/logo.png') }",
          encoding: "utf8",
        },
        { path: "notes.txt", content: "kept for the author", encoding: "utf8" },
        {
          path: "index.html",
          content: html(
            '<img src="images/logo.png">',
            '<link rel="stylesheet" href="styles/invoice.css">',
          ),
          encoding: "utf8",
        },
      ],
    });
    const restored = importTemplatePackageZip(
      exportTemplatePackageZip(templatePackage),
    );
    expect(restored.files).toEqual(templatePackage.files);
  });

  test("accepts a single enclosing ZIP folder and rejects traversal and unknown assets", () => {
    const zip = zipSync({ "theme/index.html": strToU8(html("Hello")) });
    expect(importTemplatePackageZip(zip).entry).toBe("index.html");
    expect(() =>
      validateTemplatePackage({
        version: 1,
        entry: "index.html",
        files: [
          {
            path: "index.html",
            content: html('<img src="../../secret.png">'),
            encoding: "utf8",
          },
        ],
      }),
    ).toThrow(TemplatePackageError);
    expect(() =>
      validateTemplatePackage({
        version: 1,
        entry: "index.html",
        files: [
          {
            path: "index.html",
            content: html('<img src="https://example.test/logo.png">'),
            encoding: "utf8",
          },
        ],
      }),
    ).toThrow("External or absolute");
  });

  test("renders a root-relative literal partial with isolated named values", () => {
    const templatePackage = validateTemplatePackage({
      version: 1,
      entry: "index.html",
      files: [
        {
          path: "index.html",
          content: html(
            "{% render 'partials/customer.liquid', customer: customer %}",
          ),
          encoding: "utf8",
        },
        {
          path: "partials/customer.liquid",
          content: "<p>{{ customer.name }}</p>",
          encoding: "utf8",
        },
      ],
    });
    expect(
      renderLiquidHtmlPackage(templatePackage, sampleInvoiceDocument).files[0]!
        .content,
    ).toContain("Example Customer");
  });

  test("rejects dynamic renders, cycles, and renderer bypasses", () => {
    for (const source of [
      html("{% render partial_name %}"),
      html("<base href='https://example.test/'><img src='logo.png'>"),
      html("<img srcset='logo.png 1x'>"),
      html("<meta http-equiv='refresh' content='0;url=https://example.test'>"),
    ]) {
      expect(() =>
        validateTemplatePackage({
          version: 1,
          entry: "index.html",
          files: [{ path: "index.html", content: source, encoding: "utf8" }],
        }),
      ).toThrow(TemplatePackageError);
    }
    expect(() =>
      validateTemplatePackage({
        version: 1,
        entry: "index.html",
        files: [
          {
            path: "index.html",
            content: html("{% render 'partials/a.liquid' %}"),
            encoding: "utf8",
          },
          {
            path: "partials/a.liquid",
            content: "{% render 'partials/a.liquid' %}",
            encoding: "utf8",
          },
        ],
      }),
    ).toThrow("cycle");
  });

  test("accepts inert metadata and PDF hyperlinks while blocking trimmed and liquid-block bypasses", () => {
    expect(() =>
      validateTemplatePackage({
        version: 1,
        entry: "index.html",
        files: [
          {
            path: "index.html",
            content:
              '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head><body><a href="https://example.test">Receipt</a></body></html>',
            encoding: "utf8",
          },
        ],
      }),
    ).not.toThrow();
    for (const body of [
      "{%- include 'x' -%}",
      "{% liquid\n render 'partials/x.liquid'\n%}",
    ]) {
      expect(() =>
        validateTemplatePackage({
          version: 1,
          entry: "index.html",
          files: [
            { path: "index.html", content: html(body), encoding: "utf8" },
          ],
        }),
      ).toThrow(TemplatePackageError);
    }
  });

  test("supports literal CSS imports with media qualifiers and rejects hidden resource values", () => {
    expect(() =>
      validateTemplatePackage({
        version: 1,
        entry: "index.html",
        files: [
          {
            path: "index.html",
            content: html(
              "Invoice",
              '<link rel="stylesheet" href="styles/main.css">',
            ),
            encoding: "utf8",
          },
          {
            path: "styles/main.css",
            content:
              "@import url('print.css') print; @import 'screen.css' screen;",
            encoding: "utf8",
          },
          {
            path: "styles/print.css",
            content: "body { color: black }",
            encoding: "utf8",
          },
          {
            path: "styles/screen.css",
            content: "body { color: navy }",
            encoding: "utf8",
          },
        ],
      }),
    ).not.toThrow();
    expect(() =>
      validateTemplatePackage({
        version: 1,
        entry: "index.html",
        files: [
          {
            path: "index.html",
            content: html(
              '<div style="--asset: url(https://example.test/x)"></div>',
            ),
            encoding: "utf8",
          },
        ],
      }),
    ).toThrow(TemplatePackageError);
    expect(() =>
      validateTemplatePackage({
        version: 1,
        entry: "index.html",
        files: [
          {
            path: "index.html",
            content: html(
              "Invoice",
              '<link rel="stylesheet" href="style.css">',
            ),
            encoding: "utf8",
          },
          {
            path: "style.css",
            content:
              "body { background: image-set(url(https://example.test/x) 1x) }",
            encoding: "utf8",
          },
        ],
      }),
    ).toThrow(TemplatePackageError);
  });
});
