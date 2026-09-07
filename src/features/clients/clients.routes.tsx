import { Hono, type Context } from "hono";
import { fieldErrorsFromZod } from "../../web/validation.ts";
import type { FieldErrors } from "../../web/components/forms.tsx";
import { formString, type FormBody } from "../../web/form-values.ts";
import { ClientForm } from "./components/client-form.tsx";
import {
  ClientsListPage,
  ClientWorkspacePage,
  EditClientPage,
  NewClientPage,
} from "./clients.pages.tsx";
import { ComposeInvoicePage } from "../invoices/invoices.pages.tsx";
import {
  clientSeed,
  composerContext,
  listInvoicesByClient,
} from "../invoices/invoices.service.ts";
import { emptyInvoiceFormValues } from "../invoices/invoices.view.ts";
import { isValidDateString, todayDate } from "../../domain/dates.ts";
import { clientFormSchema } from "./clients.schema.ts";
import {
  ClientCodeTakenError,
  createClient,
  getClient,
  listClients,
  listNumberingProfiles,
  updateClient,
} from "./clients.service.ts";
import {
  clientFormValuesFromBody,
  clientFormValuesFromRow,
  emptyClientFormValues,
} from "./clients.view.ts";
import { ClientSequenceCard } from "../numbering/components/client-sequence-card.tsx";
import {
  getProfile,
  previewForClient,
  setClientNextSequence,
} from "../numbering/numbering.service.ts";
import { sequenceFormSchema } from "../numbering/numbering.schema.ts";
import {
  listSelectableTemplates as listPdfTemplates,
  PdfEngineNotConfiguredError,
  PdfTemplateArchivedError,
  PdfTemplateNotFoundError,
} from "../pdf-templates/pdf-templates.service.ts";
import {
  archiveTextGenerator,
  createTextGenerator,
  LiquidSourceError,
  listClientTextGenerators,
  TextGeneratorKeyTakenError,
  TextGeneratorKeyImmutableError,
  TextGeneratorNotFoundError,
  TextGeneratorPurposeTakenError,
  updateTextGenerator,
} from "../text-generators/text-generators.service.ts";
import { textGeneratorFormSchema } from "../text-generators/text-generators.schema.ts";
import {
  TextGeneratorsSection,
  type TextGeneratorValues,
} from "../text-generators/components/text-generators-section.tsx";
import { invoiceRecordTypeFormSchema } from "../invoice-records/invoice-records.schema.ts";
import { archiveRecordType, createRecordType, listClientRecordTypes, RecordTypeKeyImmutableError, RecordTypeKeyTakenError, RecordTypeNotFoundError, RecordTypePurposeTakenError, updateRecordType } from "../invoice-records/invoice-records.service.ts";
import { RecordTypesSection, type RecordTypeValues } from "../invoice-records/components/record-types-section.tsx";

export const clientsRoutes = new Hono();

clientsRoutes.get("/", (c) =>
  c.render(<ClientsListPage clients={listClients()} />, { title: "Clients" }),
);

clientsRoutes.get("/new", (c) =>
  c.render(
    <NewClientPage
      values={emptyClientFormValues()}
      profiles={listNumberingProfiles()}
      pdfTemplates={listPdfTemplates()}
    />,
    { title: "New client" },
  ),
);

clientsRoutes.post("/", async (c) => {
  const body = (await c.req.parseBody()) as FormBody;
  const parsed = clientFormSchema.safeParse(body);

  if (!parsed.success) {
    return renderClientFormError(c, "/clients", body, fieldErrorsFromZod(parsed.error));
  }

  try {
    const client = createClient(parsed.data);
    const section = formString(body.configureSection);
    c.header("HX-Redirect", ["text", "records", "numbering"].includes(section)
      ? `/clients/${client.id}/edit?section=${section}`
      : "/clients");
    return c.body(null, 201);
  } catch (err) {
    if (err instanceof ClientCodeTakenError) {
      return renderClientFormError(c, "/clients", body, {
        code: "That code is already used by another client",
      });
    }
    if (
      err instanceof PdfTemplateNotFoundError ||
      err instanceof PdfTemplateArchivedError ||
      err instanceof PdfEngineNotConfiguredError
    ) {
      return renderClientFormError(c, "/clients", body, {
        defaultPdfTemplateId: err.message,
      });
    }
    throw err;
  }
});

clientsRoutes.get("/:id", (c) => {
  const client = getClientFromParam(c.req.param("id"));
  if (!client) return c.notFound();
  return c.render(
    <ClientWorkspacePage
      client={client}
      invoices={listInvoicesByClient(client.id)}
    />,
    { title: client.name },
  );
});

clientsRoutes.get("/:id/invoices/new", (c) => {
  const client = getClientFromParam(c.req.param("id"));
  if (!client) return c.notFound();

  const invoiceDate = todayDate();
  const seed = clientSeed(client, invoiceDate);
  const ctx = composerContext(client);
  const values = {
    ...emptyInvoiceFormValues(),
    clientId: String(client.id),
    invoiceDate,
    currency: seed.currency,
    items: seed.fixedMonthly ? [seed.fixedMonthly] : [],
    pdfTemplateId: ctx.defaultPdfTemplateId ? String(ctx.defaultPdfTemplateId) : "",
  };

  return c.render(
    <ComposeInvoicePage
      client={client}
      issuer={ctx.issuer}
      values={values}
      currencyDefault={ctx.currencyDefault}
      hasProfile={ctx.hasProfile}
      pdfTemplates={ctx.pdfTemplates}
      templateError={ctx.templateError}
    />,
    { title: "New invoice" },
  );
});

clientsRoutes.get("/:id/edit", (c) => {
  const client = getClientFromParam(c.req.param("id"));
  if (!client) return c.notFound();
  const sequenceDate = todayDate();
  const profile = client.numberingProfileId
    ? getProfile(client.numberingProfileId)
    : null;
  return c.render(
    <EditClientPage
      client={client}
      values={clientFormValuesFromRow(client)}
      profiles={listNumberingProfiles()}
      numberingPreview={profile ? previewForClient(client, profile, sequenceDate) : null}
      sequenceDate={sequenceDate}
      textGenerators={listClientTextGenerators(client.id, true)}
      recordTypes={listClientRecordTypes(client.id, true)}
      pdfTemplates={listPdfTemplates()}
    />,
    { title: client.name },
  );
});

clientsRoutes.post("/:id/record-types", async (c) => {
  const client = getClientFromParam(c.req.param("id"));
  if (!client) return c.notFound();
  const body = (await c.req.parseBody()) as FormBody;
  const parsed = invoiceRecordTypeFormSchema.safeParse(body);
  if (!parsed.success) return renderRecordTypes(c, client.id, "new", body, fieldErrorsFromZod(parsed.error));
  try { createRecordType(client.id, parsed.data); return c.html(<RecordTypesSection clientId={client.id} recordTypes={listClientRecordTypes(client.id, true)} saved="Record type created." />); }
  catch (error) { return renderRecordTypeServiceError(c, client.id, "new", body, error); }
});

clientsRoutes.post("/:id/record-types/:recordTypeId", async (c) => {
  const client = getClientFromParam(c.req.param("id"));
  const recordTypeId = positiveInt(c.req.param("recordTypeId"));
  if (!client || !recordTypeId) return c.notFound();
  const body = (await c.req.parseBody()) as FormBody;
  const parsed = invoiceRecordTypeFormSchema.safeParse(body);
  if (!parsed.success) return renderRecordTypes(c, client.id, recordTypeId, body, fieldErrorsFromZod(parsed.error));
  try { updateRecordType(client.id, recordTypeId, parsed.data); return c.html(<RecordTypesSection clientId={client.id} recordTypes={listClientRecordTypes(client.id, true)} saved="Record type saved." />); }
  catch (error) { return renderRecordTypeServiceError(c, client.id, recordTypeId, body, error); }
});

clientsRoutes.delete("/:id/record-types/:recordTypeId", (c) => {
  const client = getClientFromParam(c.req.param("id"));
  const recordTypeId = positiveInt(c.req.param("recordTypeId"));
  if (!client || !recordTypeId) return c.notFound();
  try { archiveRecordType(client.id, recordTypeId); }
  catch (error) { if (error instanceof RecordTypeNotFoundError) return c.notFound(); throw error; }
  return c.html(<RecordTypesSection clientId={client.id} recordTypes={listClientRecordTypes(client.id, true)} saved="Record type archived. Existing records and files were kept." />);
});

clientsRoutes.post("/:id/text-generators", async (c) => {
  const client = getClientFromParam(c.req.param("id"));
  if (!client) return c.notFound();
  const body = (await c.req.parseBody()) as FormBody;
  const parsed = textGeneratorFormSchema.safeParse(body);
  if (!parsed.success) {
    return renderTextGenerators(c, client.id, "new", body, fieldErrorsFromZod(parsed.error));
  }
  try {
    createTextGenerator(client.id, parsed.data);
    return c.html(
      <TextGeneratorsSection
        clientId={client.id}
        generators={listClientTextGenerators(client.id, true)}
        saved="Text generator created."
      />,
    );
  } catch (error) {
    return renderTextGeneratorServiceError(c, client.id, "new", body, error);
  }
});

clientsRoutes.post("/:id/text-generators/:generatorId", async (c) => {
  const client = getClientFromParam(c.req.param("id"));
  const generatorId = positiveInt(c.req.param("generatorId"));
  if (!client || !generatorId) return c.notFound();
  const body = (await c.req.parseBody()) as FormBody;
  const parsed = textGeneratorFormSchema.safeParse(body);
  if (!parsed.success) {
    return renderTextGenerators(c, client.id, generatorId, body, fieldErrorsFromZod(parsed.error));
  }
  try {
    updateTextGenerator(client.id, generatorId, parsed.data);
    return c.html(
      <TextGeneratorsSection
        clientId={client.id}
        generators={listClientTextGenerators(client.id, true)}
        saved="Text generator saved."
      />,
    );
  } catch (error) {
    return renderTextGeneratorServiceError(c, client.id, generatorId, body, error);
  }
});

clientsRoutes.delete("/:id/text-generators/:generatorId", (c) => {
  const client = getClientFromParam(c.req.param("id"));
  const generatorId = positiveInt(c.req.param("generatorId"));
  if (!client || !generatorId) return c.notFound();
  try {
    archiveTextGenerator(client.id, generatorId);
  } catch (error) {
    if (error instanceof TextGeneratorNotFoundError) return c.notFound();
    throw error;
  }
  return c.html(
    <TextGeneratorsSection
      clientId={client.id}
      generators={listClientTextGenerators(client.id, true)}
      saved="Text generator archived. Saved invoice text was kept."
    />,
  );
});

clientsRoutes.post("/:id", async (c) => {
  const client = getClientFromParam(c.req.param("id"));
  if (!client) return c.notFound();

  const action = `/clients/${client.id}`;
  const body = (await c.req.parseBody()) as FormBody;
  const parsed = clientFormSchema.safeParse(body);

  if (!parsed.success) {
    return renderClientFormError(c, action, body, fieldErrorsFromZod(parsed.error));
  }

  try {
    const updated = updateClient(client.id, parsed.data);
    return c.html(
      <ClientForm
        action={action}
        values={clientFormValuesFromRow(updated)}
        profiles={listNumberingProfiles()}
        pdfTemplates={listPdfTemplates()}
        submitLabel="Save changes"
        saved
      />,
    );
  } catch (err) {
    if (err instanceof ClientCodeTakenError) {
      return renderClientFormError(c, action, body, {
        code: "That code is already used by another client",
      });
    }
    if (
      err instanceof PdfTemplateNotFoundError ||
      err instanceof PdfTemplateArchivedError ||
      err instanceof PdfEngineNotConfiguredError
    ) {
      return renderClientFormError(c, action, body, {
        defaultPdfTemplateId: err.message,
      });
    }
    throw err;
  }
});

clientsRoutes.post("/:id/numbering-sequence", async (c) => {
  const client = getClientFromParam(c.req.param("id"));
  if (!client) return c.notFound();

  const body = (await c.req.parseBody()) as FormBody;
  const invoiceDate = formString(body.invoiceDate) || todayDate();
  const profile = client.numberingProfileId
    ? getProfile(client.numberingProfileId)
    : null;
  if (!profile) {
    c.status(422);
    return c.html(
      <ClientSequenceCard
        client={client}
        preview={null}
        invoiceDate={invoiceDate}
      />,
    );
  }

  if (!isValidDateString(invoiceDate)) {
    c.status(422);
    return c.html(
      <ClientSequenceCard
        client={client}
        preview={previewForClient(client, profile, todayDate())}
        invoiceDate={invoiceDate}
        errors={{ invoiceDate: "Enter a valid date" }}
      />,
    );
  }

  const parsed = sequenceFormSchema.safeParse(body);
  if (!parsed.success) {
    c.status(422);
    return c.html(
      <ClientSequenceCard
        client={client}
        preview={previewForClient(client, profile, invoiceDate)}
        invoiceDate={invoiceDate}
        errors={fieldErrorsFromZod(parsed.error)}
      />,
    );
  }

  setClientNextSequence(client, profile, invoiceDate, parsed.data);
  return c.html(
    <ClientSequenceCard
      client={client}
      preview={previewForClient(client, profile, invoiceDate)}
      invoiceDate={invoiceDate}
      saved
    />,
  );
});

// --- helpers -------------------------------------------------------------

function getClientFromParam(raw: string) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return null;
  return getClient(id);
}

function positiveInt(raw: string): number | null {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function textGeneratorValues(body: FormBody): TextGeneratorValues {
  return {
    name: formString(body.name),
    key: formString(body.key),
    purpose: formString(body.purpose) === "nfse-description" ? "nfse-description" : "custom",
    source: formString(body.source),
  };
}

function renderTextGenerators(
  c: Context,
  clientId: number,
  editor: "new" | number,
  body: FormBody,
  errors: FieldErrors,
) {
  c.status(422);
  return c.html(
    <TextGeneratorsSection
      clientId={clientId}
      generators={listClientTextGenerators(clientId, true)}
      editor={editor}
      errors={errors}
      submittedValues={textGeneratorValues(body)}
    />,
  );
}

function renderTextGeneratorServiceError(
  c: Context,
  clientId: number,
  editor: "new" | number,
  body: FormBody,
  error: unknown,
) {
  if (error instanceof TextGeneratorKeyTakenError) {
    return renderTextGenerators(c, clientId, editor, body, { key: error.message });
  }
  if (error instanceof TextGeneratorKeyImmutableError) {
    return renderTextGenerators(c, clientId, editor, body, { key: error.message });
  }
  if (error instanceof TextGeneratorPurposeTakenError) {
    return renderTextGenerators(c, clientId, editor, body, { purpose: error.message });
  }
  if (error instanceof LiquidSourceError) {
    return renderTextGenerators(c, clientId, editor, body, { source: error.message });
  }
  if (error instanceof TextGeneratorNotFoundError) return c.notFound();
  throw error;
}

function recordTypeValues(body: FormBody): RecordTypeValues {
  const parse = (value: FormBody[string] | undefined) => { try { const parsed = JSON.parse(formString(value)); return Array.isArray(parsed) ? parsed : []; } catch { return []; } };
  return { name: formString(body.name), key: formString(body.key), purpose: formString(body.purpose) === "nfse" ? "nfse" : "custom", allowMultiple: body.allowMultiple === "on" || body.allowMultiple === "true", fields: parse(body.fieldDefinitionsJson), attachments: parse(body.attachmentDefinitionsJson) };
}

function renderRecordTypes(c: Context, clientId: number, editor: "new" | number, body: FormBody, errors: FieldErrors) {
  c.status(422);
  return c.html(<RecordTypesSection clientId={clientId} recordTypes={listClientRecordTypes(clientId, true)} editor={editor} errors={errors} submittedValues={recordTypeValues(body)} />);
}

function renderRecordTypeServiceError(c: Context, clientId: number, editor: "new" | number, body: FormBody, error: unknown) {
  if (error instanceof RecordTypeKeyTakenError || error instanceof RecordTypeKeyImmutableError) return renderRecordTypes(c, clientId, editor, body, { key: error.message });
  if (error instanceof RecordTypePurposeTakenError) return renderRecordTypes(c, clientId, editor, body, { purpose: error.message });
  if (error instanceof RecordTypeNotFoundError) return c.notFound();
  throw error;
}

function renderClientFormError(
  c: Context,
  action: string,
  body: FormBody,
  errors: FieldErrors,
) {
  c.status(422);
  const submitLabel = action === "/clients" ? "Create client" : "Save changes";
  return c.html(
    <ClientForm
      action={action}
      values={clientFormValuesFromBody(body)}
      profiles={listNumberingProfiles()}
      pdfTemplates={listPdfTemplates()}
      submitLabel={submitLabel}
      errors={errors}
    />,
  );
}
