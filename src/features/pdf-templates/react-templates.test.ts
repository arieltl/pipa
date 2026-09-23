import { describe, expect, test } from "bun:test";
import { createApp } from "../../app.tsx";
import {
  exportTemplatePackageZip,
  importTemplatePackageZip,
  reactPackageFromSource,
  type TemplatePackage,
} from "../../domain/template-package.ts";
import { pdfTemplates } from "../../db/schema.ts";
import { db } from "../../db/client.ts";
import {
  createTemplate,
  duplicateTemplate,
  getRevision,
  getRevisionPackage,
  getTemplate,
  reviseTemplate,
} from "./pdf-templates.service.ts";

const app = createApp();
const primitives =
  'import { Document, Page, Text } from "@react-pdf/renderer";';
const source = (label: string) => `${primitives}
  export default function Template({ document }) {
    return <Document title={document.invoice.number}><Page><Text>${label}: {document.invoice.number}</Text></Page></Document>;
  }`;

function packageWithLocalComponent(label: string): TemplatePackage {
  return {
    version: 1,
    entry: "index.tsx",
    files: [
      {
        path: "index.tsx",
        encoding: "utf8",
        content: `${primitives}
        import { Label } from "./parts/label";
        export default function Template({ document }) { return <Document><Page><Label value={document.invoice.number} /></Page></Document>; }`,
      },
      {
        path: "parts/label.tsx",
        encoding: "utf8",
        content: `${primitives}
        export function Label({ value }) { return <Text>${label}: {value}</Text>; }`,
      },
    ],
  };
}

describe("editable React PDF templates", () => {
  test("duplicates the immutable Classic renderer as an editable canonical TSX package", async () => {
    const classic = db
      .select()
      .from(pdfTemplates)
      .all()
      .find((item) => item.stableKey === "builtin-react-classic");
    expect(classic).toBeDefined();
    const copy = await duplicateTemplate(
      classic!.id,
      `Classic copy ${crypto.randomUUID()}`,
    );
    const revision = getRevision(copy.currentRevisionId!);
    const pkg = getRevisionPackage(revision);

    expect(copy.engine).toBe("react-pdf");
    expect(copy.sourceKind).toBe("user");
    expect(pkg.entry).toBe("index.tsx");
    expect(pkg.files[0]?.content).toContain("{ document }");
    expect(revision.rendererKey).toBeNull();
  });

  test("persists a complete React package and leaves the prior revision unchanged", async () => {
    const firstPackage = packageWithLocalComponent("First");
    const template = await createTemplate(
      `React package ${crypto.randomUUID()}`,
      "react-pdf",
      firstPackage.files[0]!.content,
      firstPackage,
    );
    const first = getRevision(template.currentRevisionId!);
    const secondPackage = packageWithLocalComponent("Second");
    const second = await reviseTemplate(
      template.id,
      `${template.name} v2`,
      "react-pdf",
      secondPackage.files[0]!.content,
      secondPackage,
    );

    expect(second.revision).toBe(first.revision + 1);
    expect(
      getRevisionPackage(first).files.find(
        (file) => file.path === "parts/label.tsx",
      )?.content,
    ).toContain("First");
    expect(
      getRevisionPackage(second).files.find(
        (file) => file.path === "parts/label.tsx",
      )?.content,
    ).toContain("Second");
    expect(getTemplate(template.id).currentRevisionId).toBe(second.id);
  });

  test("rejects invalid React source before it creates a template or revision", async () => {
    const before = db.select().from(pdfTemplates).all().length;
    await expect(
      createTemplate(
        `Invalid ${crypto.randomUUID()}`,
        "react-pdf",
        "export default () => <Document />",
      ),
    ).rejects.toThrow();
    expect(db.select().from(pdfTemplates).all()).toHaveLength(before);
  });

  test("round-trips standalone TSX and React ZIP packages", () => {
    const standalone = reactPackageFromSource(source("Standalone"));
    expect(
      importTemplatePackageZip(exportTemplatePackageZip(standalone)),
    ).toEqual(standalone);
    const multi = packageWithLocalComponent("ZIP");
    expect(importTemplatePackageZip(exportTemplatePackageZip(multi))).toEqual(
      multi,
    );
  });

  test("route rejects an engine/package disagreement and malformed package entry", async () => {
    const mismatch = await app.request("/settings/pdf-templates/preview.pdf", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        engine: "gotenberg-html",
        packageJson: JSON.stringify(reactPackageFromSource(source("Mismatch"))),
      }),
    });
    expect(mismatch.status).toBe(422);
    expect(await mismatch.text()).toContain("different PDF engine");

    const forged = await app.request("/settings/pdf-templates/preview.pdf", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        engine: "react-pdf",
        packageJson: JSON.stringify({
          version: 1,
          entry: "../index.tsx",
          files: [],
        }),
      }),
    });
    expect(forged.status).toBe(422);
  });

  test("invalid React saves return an editable error page without advancing a revision", async () => {
    const template = await createTemplate(
      "React failed-save test",
      "react-pdf",
      source("Original"),
    );
    const invalid =
      "export default function Template() { throw new Error('BROKEN_TEMPLATE'); }";
    const response = await app.request(
      `/settings/pdf-templates/${template.id}/revisions`,
      {
        method: "POST",
        body: new URLSearchParams({
          engine: "react-pdf",
          name: "Still editing",
          source: invalid,
        }),
      },
    );
    expect(response.status).toBe(422);
    expect(await response.text()).toContain("BROKEN_TEMPLATE");
    expect(getTemplate(template.id).currentRevisionId).toBe(
      template.currentRevisionId,
    );
    const preview = await app.request("/settings/pdf-templates/preview.pdf", {
      method: "POST",
      body: new URLSearchParams({ engine: "react-pdf", source: invalid }),
    });
    expect(preview.status).toBe(422);
  });

  test("new React workspace and standalone TSX import retain their engine", async () => {
    const page = await app.request(
      "/settings/pdf-templates/new?engine=react-pdf",
    );
    expect(await page.text()).toContain('data-template-engine="react-pdf"');
    const form = new FormData();
    form.set(
      "file",
      new File([source("Imported")], "invoice.tsx", { type: "text/plain" }),
    );
    const response = await app.request("/settings/pdf-templates/import", {
      method: "POST",
      body: form,
    });
    expect(response.status).toBe(303);
    const id = Number(response.headers.get("location")!.split("/").at(-1));
    expect(getTemplate(id).engine).toBe("react-pdf");
    const exported = await app.request(`/settings/pdf-templates/${id}/source`);
    expect(exported.headers.get("content-disposition")).toContain(".tsx");
    expect(await exported.text()).toBe(source("Imported"));
  });

  test("HTML preview remains an HTML/Gotenberg request when no React engine is supplied", async () => {
    const html =
      "<!doctype html><html><head><title>Preview</title></head><body>Legacy HTML</body></html>";
    const response = await app.request("/settings/pdf-templates/preview.pdf", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ source: html }),
    });
    expect(response.status).toBe(503);
    expect(await response.text()).toContain("Gotenberg");
  });
});
