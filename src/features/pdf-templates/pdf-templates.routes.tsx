import { Hono, type Context } from "hono";
import { fieldErrorsFromZod } from "../../web/validation.ts";
import { formString, type FormBody } from "../../web/form-values.ts";
import { LiquidSourceError } from "../../pdf/html/liquid-engine.ts";
import {
  exportTemplatePackageZip,
  findPackageFile,
  importTemplatePackageZip,
  packageFromSource,
  parseTemplatePackage,
  type TemplatePackage,
  TemplatePackageError,
} from "../../domain/template-package.ts";
import {
  createHtmlTemplate,
  duplicateHtmlTemplate,
  getRevisionPackage,
  getRevision,
  getTemplate,
  listTemplateRevisions,
  listTemplates,
  PdfEngineNotConfiguredError,
  PdfTemplateImmutableError,
  PdfTemplateNotFoundError,
  renderHtmlPreviewPdf,
  renderHtmlSample,
  renderTemplateSamplePdf,
  reviseHtmlTemplate,
} from "./pdf-templates.service.ts";
import {
  duplicateTemplateSchema,
  htmlTemplateFormSchema,
  htmlTemplatePreviewSchema,
} from "./pdf-templates.schema.ts";
import {
  PdfTemplateDetailPage,
  PdfTemplateNewPage,
  PdfTemplatesPage,
  GotenbergStatusCard,
  type HtmlTemplateValues,
} from "./pdf-templates.pages.tsx";
import { getGotenbergStatus } from "./pdf-engine-status.ts";

export const pdfTemplatesRoutes = new Hono();

pdfTemplatesRoutes.get("/", async (c) => {
  const raw = c.req.query("engine");
  const engine = raw === "react-pdf" || raw === "gotenberg-html" ? raw : undefined;
  const templates = listTemplates(engine);
  return c.render(<PdfTemplatesPage templates={templates} engine={engine} gotenbergStatus={await getGotenbergStatus()} revisionNumbers={revisionNumbersFor(templates)} />, { title: "PDF templates" });
});

pdfTemplatesRoutes.post("/engine-check", async (c) =>
  c.html(<GotenbergStatusCard status={await getGotenbergStatus(true)} compact />),
);

// This endpoint intentionally precedes `/:id` routes. It renders editor input
// transiently and must never create a template, revision, or stored file.
pdfTemplatesRoutes.post("/preview.pdf", async (c) => {
  const body = (await c.req.parseBody()) as FormBody;
  const parsed = htmlTemplatePreviewSchema.safeParse(body);
  if (!parsed.success) {
    const errors = fieldErrorsFromZod(parsed.error);
    return c.text(errors.packageJson ?? errors.source ?? "Invalid HTML source", 422);
  }
  try {
    const templatePackage = packageFromRequest(parsed.data.source ?? "", parsed.data.packageJson);
    const buffer = await renderHtmlPreviewPdf(
      parsed.data.source ?? findPackageFile(templatePackage, templatePackage.entry)!.content,
      undefined,
      templatePackage,
    );
    c.header("Content-Type", "application/pdf");
    c.header("Cache-Control", "no-store");
    return c.body(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer);
  } catch (error) {
    if (error instanceof LiquidSourceError || error instanceof TemplatePackageError) return c.text(error.message, 422);
    if (error instanceof PdfEngineNotConfiguredError) return c.text(error.message, 503);
    return c.text(
      error instanceof Error ? `PDF preview failed: ${error.message}` : "PDF preview failed",
      503,
    );
  }
});

pdfTemplatesRoutes.post("/import", async (c) => {
  const body = (await c.req.parseBody()) as FormBody;
  const file = body.file;
  if (!(file instanceof File) || file.size === 0 || file.size > 10 * 1024 * 1024) {
    c.status(422);
    return c.render(
      <PdfTemplatesPage
        templates={listTemplates()}
        errors={{ _form: "Choose an HTML/Liquid file or ZIP no larger than 10 MiB." }}
        gotenbergStatus={await getGotenbergStatus()}
      />,
      { title: "PDF templates" },
    );
  }
  let templatePackage: TemplatePackage;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const isZip = file.name.toLowerCase().endsWith(".zip") || (bytes[0] === 0x50 && bytes[1] === 0x4b);
    templatePackage = isZip
      ? importTemplatePackageZip(bytes)
      : packageFromSource(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    c.status(422);
    return c.render(
      <PdfTemplatesPage
        templates={listTemplates()}
        errors={{ _form: error instanceof Error ? error.message : "The template file could not be imported." }}
        gotenbergStatus={await getGotenbergStatus()}
      />,
      { title: "PDF templates" },
    );
  }
  const imported = {
    name: file.name.replace(/\.(?:zip|html?|liquid|txt)$/i, "").trim() || "Imported HTML template",
    source: findPackageFile(templatePackage, templatePackage.entry)!.content,
    packageJson: JSON.stringify(templatePackage),
  };
  const parsed = htmlTemplateFormSchema.safeParse(imported);
  if (!parsed.success) {
    c.status(422);
    return c.render(
      <PdfTemplateNewPage
        values={imported}
        errors={fieldErrorsFromZod(parsed.error)}
        gotenbergStatus={await getGotenbergStatus()}
      />,
      { title: "New PDF template", templateWorkspace: true },
    );
  }
  try {
    const template = createHtmlTemplate(parsed.data.name, parsed.data.source ?? findPackageFile(templatePackage, templatePackage.entry)!.content, templatePackage);
    return c.redirect(`/settings/pdf-templates/${template.id}`, 303);
  } catch (error) {
    if (error instanceof LiquidSourceError) {
      c.status(422);
      return c.render(
        <PdfTemplateNewPage
          values={imported}
          errors={{ source: error.message }}
          gotenbergStatus={await getGotenbergStatus()}
        />,
        { title: "New PDF template", templateWorkspace: true },
      );
    }
    throw error;
  }
});

pdfTemplatesRoutes.post("/", async (c) => {
  const body = (await c.req.parseBody()) as FormBody;
  const parsed = htmlTemplateFormSchema.safeParse(body);
  const values = valuesFromBody(body);
  if (!parsed.success) {
    c.status(422);
    return c.render(<PdfTemplateNewPage values={values} errors={fieldErrorsFromZod(parsed.error)} gotenbergStatus={await getGotenbergStatus()} />, { title: "New PDF template", templateWorkspace: true });
  }
  try {
    const templatePackage = packageFromRequest(parsed.data.source ?? "", parsed.data.packageJson);
    const template = createHtmlTemplate(parsed.data.name, parsed.data.source ?? findPackageFile(templatePackage, templatePackage.entry)!.content, templatePackage);
    return c.redirect(`/settings/pdf-templates/${template.id}`, 303);
  } catch (error) {
    if (error instanceof LiquidSourceError || error instanceof TemplatePackageError) {
      c.status(422);
      return c.render(<PdfTemplateNewPage values={values} errors={{ source: error.message }} gotenbergStatus={await getGotenbergStatus()} />, { title: "New PDF template", templateWorkspace: true });
    }
    throw error;
  }
});

pdfTemplatesRoutes.get("/new", async (c) =>
  c.render(<PdfTemplateNewPage gotenbergStatus={await getGotenbergStatus()} />, { title: "New PDF template", templateWorkspace: true }),
);

pdfTemplatesRoutes.get("/:id", (c) => renderDetail(c, Number(c.req.param("id"))));

pdfTemplatesRoutes.get("/:id/sample.pdf", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) return c.notFound();
  try {
    const template = getTemplate(id);
    const buffer = await renderTemplateSamplePdf(id);
    c.header("Content-Type", "application/pdf");
    c.header("Content-Disposition", `attachment; filename="${template.name.replace(/[^a-z0-9_-]+/gi, "-")}-sample.pdf"`);
    return c.body(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer);
  } catch (error) {
    if (error instanceof PdfTemplateNotFoundError) return c.notFound();
    if (error instanceof PdfEngineNotConfiguredError) return c.text(error.message, 503);
    return c.text(
      error instanceof Error ? `PDF preview failed: ${error.message}` : "PDF preview failed",
      503,
    );
  }
});

pdfTemplatesRoutes.get("/:id/source", (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) return c.notFound();
  try {
    const template = getTemplate(id);
    const revision = getRevision(template.currentRevisionId ?? 0);
    if (template.engine !== "gotenberg-html" || !revision.source) return c.notFound();
    const templatePackage = getRevisionPackage(revision);
    const basename = template.name.replace(/[^a-z0-9_-]+/gi, "-") || "template";
    if (templatePackage.files.length === 1) {
      c.header("Content-Type", "text/html; charset=utf-8");
      c.header("Content-Disposition", `attachment; filename="${basename}.liquid.html"`);
      return c.body(findPackageFile(templatePackage, templatePackage.entry)!.content);
    }
    const zip = exportTemplatePackageZip(templatePackage);
    c.header("Content-Type", "application/zip");
    c.header("Content-Disposition", `attachment; filename="${basename}.zip"`);
    return c.body(zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer);
  } catch (error) {
    if (error instanceof PdfTemplateNotFoundError) return c.notFound();
    throw error;
  }
});

pdfTemplatesRoutes.post("/:id/revisions", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) return c.notFound();
  const body = (await c.req.parseBody()) as FormBody;
  const parsed = htmlTemplateFormSchema.safeParse(body);
  const values = valuesFromBody(body);
  if (!parsed.success) return renderDetail(c, id, values, fieldErrorsFromZod(parsed.error), 422);
  try {
    const templatePackage = packageFromRequest(parsed.data.source ?? "", parsed.data.packageJson);
    reviseHtmlTemplate(id, parsed.data.name, parsed.data.source ?? findPackageFile(templatePackage, templatePackage.entry)!.content, templatePackage);
    return c.redirect(`/settings/pdf-templates/${id}`, 303);
  } catch (error) {
    if (error instanceof LiquidSourceError || error instanceof TemplatePackageError || error instanceof PdfTemplateImmutableError) {
      return renderDetail(c, id, values, { source: error.message }, 422);
    }
    throw error;
  }
});

pdfTemplatesRoutes.post("/:id/duplicate", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) return c.notFound();
  const body = (await c.req.parseBody()) as FormBody;
  const parsed = duplicateTemplateSchema.safeParse(body);
  if (!parsed.success) return c.notFound();
  try {
    const copy = duplicateHtmlTemplate(id, parsed.data.name);
    return c.redirect(`/settings/pdf-templates/${copy.id}`, 303);
  } catch (error) {
    if (error instanceof PdfTemplateNotFoundError) return c.notFound();
    throw error;
  }
});

async function renderDetail(c: Context, id: number, submitted?: HtmlTemplateValues, errors = {}, status?: 422) {
  if (!Number.isInteger(id) || id <= 0) return c.notFound();
  try {
    const template = getTemplate(id);
    const revision = getRevision(template.currentRevisionId ?? 0);
    const templatePackage = template.engine === "gotenberg-html" ? getRevisionPackage(revision) : undefined;
    if (status) c.status(status);
    return c.render(
      <PdfTemplateDetailPage
        template={template}
        revision={revision}
        revisions={listTemplateRevisions(id)}
        values={submitted ?? { name: template.name, source: revision.source ?? "", packageJson: templatePackage ? JSON.stringify(templatePackage) : undefined }}
        errors={errors}
        renderedSample={templatePackage ? renderHtmlSample(revision.source ?? "", templatePackage) : undefined}
        gotenbergStatus={await getGotenbergStatus()}
      />,
      { title: template.name, templateWorkspace: template.engine === "gotenberg-html" },
    );
  } catch (error) {
    if (error instanceof PdfTemplateNotFoundError) return c.notFound();
    throw error;
  }
}

function valuesFromBody(body: FormBody): HtmlTemplateValues {
  return { name: formString(body.name), source: formString(body.source), packageJson: formString(body.packageJson) || undefined };
}

function packageFromRequest(source: string, packageJson?: string): TemplatePackage {
  return packageJson?.trim() ? parseTemplatePackage(packageJson) : packageFromSource(source);
}

function revisionNumbersFor(templates: ReturnType<typeof listTemplates>): Record<number, number> {
  return Object.fromEntries(
    templates.map((template) => [
      template.id,
      template.currentRevisionId ? getRevision(template.currentRevisionId).revision : 0,
    ]),
  );
}
