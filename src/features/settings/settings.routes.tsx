import { Hono } from "hono";
import { fieldErrorsFromZod } from "../../web/validation.ts";
import type { FormBody } from "../../web/form-values.ts";
import { IssuerForm } from "./components/issuer-form.tsx";
import { IssuerSettingsPage } from "./settings.page.tsx";
import { issuerFormSchema } from "./settings.schema.ts";
import { loadIssuerSettings, updateIssuerSettings } from "./settings.service.ts";
import {
  issuerFormValuesFromBody,
  issuerFormValuesFromRow,
} from "./settings.view.ts";
import {
  listSelectableTemplates as listPdfTemplates,
  PdfEngineNotConfiguredError,
  PdfTemplateArchivedError,
  PdfTemplateNotFoundError,
} from "../pdf-templates/pdf-templates.service.ts";

export const settingsRoutes = new Hono();

settingsRoutes.get("/issuer", (c) => {
  const values = issuerFormValuesFromRow(loadIssuerSettings());
  return c.render(<IssuerSettingsPage values={values} pdfTemplates={listPdfTemplates()} />, {
    title: "Issuer settings",
  });
});

settingsRoutes.post("/issuer", async (c) => {
  const body = (await c.req.parseBody()) as FormBody;
  const parsed = issuerFormSchema.safeParse(body);

  if (!parsed.success) {
    c.status(422);
    return c.html(
      <IssuerForm
        values={issuerFormValuesFromBody(body)}
        errors={fieldErrorsFromZod(parsed.error)}
        pdfTemplates={listPdfTemplates()}
      />,
    );
  }

  try {
    const saved = updateIssuerSettings(parsed.data);
    return c.html(<IssuerForm values={issuerFormValuesFromRow(saved)} pdfTemplates={listPdfTemplates()} saved />);
  } catch (error) {
    if (
      error instanceof PdfTemplateNotFoundError ||
      error instanceof PdfTemplateArchivedError ||
      error instanceof PdfEngineNotConfiguredError
    ) {
      c.status(422);
      return c.html(
        <IssuerForm
          values={issuerFormValuesFromBody(body)}
          pdfTemplates={listPdfTemplates()}
          errors={{ defaultPdfTemplateId: error.message }}
        />,
      );
    }
    throw error;
  }
});
