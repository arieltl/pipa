import { Hono, type Context } from "hono";
import { fieldErrorsFromZod } from "../../web/validation.ts";
import { formString, type FormBody } from "../../web/form-values.ts";
import { LiquidSourceError } from "../../pdf/html/liquid-engine.ts";
import {
  createHtmlTemplate,
  duplicateHtmlTemplate,
  getRevision,
  getTemplate,
  listTemplateRevisions,
  listTemplates,
  PdfEngineNotConfiguredError,
  PdfTemplateImmutableError,
  PdfTemplateNotFoundError,
  renderHtmlSample,
  renderTemplateSamplePdf,
  reviseHtmlTemplate,
} from "./pdf-templates.service.ts";
import {
  duplicateTemplateSchema,
  htmlTemplateFormSchema,
} from "./pdf-templates.schema.ts";
import {
  PdfTemplateDetailPage,
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
  c.html(<GotenbergStatusCard status={await getGotenbergStatus(true)} />),
);

pdfTemplatesRoutes.post("/import", async (c) => {
  const body = (await c.req.parseBody()) as FormBody;
  const file = body.file;
  if (!(file instanceof File) || file.size === 0 || file.size > 20_000) {
    c.status(422);
    return c.render(
      <PdfTemplatesPage
        templates={listTemplates()}
        errors={{ _form: "Choose an HTML/Liquid file no larger than 20 KB." }}
        gotenbergStatus={await getGotenbergStatus()}
      />,
      { title: "PDF templates" },
    );
  }
  const imported = {
    name: file.name.replace(/\.(?:html?|liquid)$/i, "").trim() || "Imported HTML template",
    source: await file.text(),
  };
  const parsed = htmlTemplateFormSchema.safeParse(imported);
  if (!parsed.success) {
    c.status(422);
    return c.render(
      <PdfTemplatesPage
        templates={listTemplates()}
        values={imported}
        errors={fieldErrorsFromZod(parsed.error)}
        gotenbergStatus={await getGotenbergStatus()}
      />,
      { title: "PDF templates" },
    );
  }
  try {
    const template = createHtmlTemplate(parsed.data.name, parsed.data.source);
    return c.redirect(`/settings/pdf-templates/${template.id}`, 303);
  } catch (error) {
    if (error instanceof LiquidSourceError) {
      c.status(422);
      return c.render(
        <PdfTemplatesPage
          templates={listTemplates()}
          values={imported}
          errors={{ source: error.message }}
          gotenbergStatus={await getGotenbergStatus()}
        />,
        { title: "PDF templates" },
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
    return c.render(<PdfTemplatesPage templates={listTemplates()} values={values} errors={fieldErrorsFromZod(parsed.error)} gotenbergStatus={await getGotenbergStatus()} />, { title: "PDF templates" });
  }
  try {
    const template = createHtmlTemplate(parsed.data.name, parsed.data.source);
    return c.redirect(`/settings/pdf-templates/${template.id}`, 303);
  } catch (error) {
    if (error instanceof LiquidSourceError) {
      c.status(422);
      return c.render(<PdfTemplatesPage templates={listTemplates()} values={values} errors={{ source: error.message }} gotenbergStatus={await getGotenbergStatus()} />, { title: "PDF templates" });
    }
    throw error;
  }
});

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
    const basename = template.name.replace(/[^a-z0-9_-]+/gi, "-") || "template";
    c.header("Content-Type", "text/html; charset=utf-8");
    c.header("Content-Disposition", `attachment; filename="${basename}.liquid.html"`);
    return c.body(revision.source);
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
    reviseHtmlTemplate(id, parsed.data.name, parsed.data.source);
    return c.redirect(`/settings/pdf-templates/${id}`, 303);
  } catch (error) {
    if (error instanceof LiquidSourceError || error instanceof PdfTemplateImmutableError) {
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
    if (status) c.status(status);
    return c.render(
      <PdfTemplateDetailPage
        template={template}
        revision={revision}
        revisions={listTemplateRevisions(id)}
        values={submitted ?? { name: template.name, source: revision.source ?? "" }}
        errors={errors}
        renderedSample={revision.source ? renderHtmlSample(revision.source) : undefined}
        gotenbergStatus={await getGotenbergStatus()}
      />,
      { title: template.name },
    );
  } catch (error) {
    if (error instanceof PdfTemplateNotFoundError) return c.notFound();
    throw error;
  }
}

function valuesFromBody(body: FormBody): HtmlTemplateValues {
  return { name: formString(body.name), source: formString(body.source) };
}

function revisionNumbersFor(templates: ReturnType<typeof listTemplates>): Record<number, number> {
  return Object.fromEntries(
    templates.map((template) => [
      template.id,
      template.currentRevisionId ? getRevision(template.currentRevisionId).revision : 0,
    ]),
  );
}
