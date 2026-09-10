import { Hono, type Context } from "hono";
import { existsSync } from "node:fs";
import {
  getClient as getClientById,
  getDefaultClient,
  listClients,
} from "../clients/clients.service.ts";
import { fieldErrorsFromZod } from "../../web/validation.ts";
import { Alert, type FieldErrors } from "../../web/components/forms.tsx";
import { formString, type FormBody } from "../../web/form-values.ts";
import { InvoiceComposer } from "./components/invoice-composer.tsx";
import { ItemsSection } from "./components/items-section.tsx";
import { NfseSection } from "./components/nfse-section.tsx";
import { GeneratedTextCard } from "./components/generated-texts-section.tsx";
import { NfseLinkSection } from "./components/nfse-link-section.tsx";
import { PdfSection } from "./components/pdf-section.tsx";
import {
  InvoiceDocFields,
  InvoiceHeaderStatus,
  NotesEditor,
  WorkflowHeader,
} from "./components/invoice-detail.tsx";
import {
  InvoiceDetailPage,
  InvoicesListPage,
  PickClientPage,
} from "./invoices.pages.tsx";
import {
  createInvoiceSchema,
  editInvoiceDocSchema,
  itemFormSchema,
  notaFiscalLinkSchema,
  notesSchema,
  pdfTemplateSelectionSchema,
  statusSchema,
} from "./invoices.schema.ts";
import {
  isDocumentEditable,
  type InvoiceStatus,
} from "../../domain/invoice-status.ts";
import {
  addItem,
  archiveInvoicePdf,
  changeStatus,
  ClientNotFoundError,
  clientInvoiceStats,
  composerContext,
  createInvoice,
  deleteInvoice,
  deleteItem,
  DocumentLockedError,
  updateInvoiceDoc,
  EmptyInvoiceError,
  generateNfseDescription,
  generateCustomText,
  getInvoiceDetail,
  getInvoiceFile,
  getItem,
  InvalidStatusTransitionError,
  InvoiceNumberRequiredError,
  InvoiceNumberTakenError,
  issueInvoice,
  linkNotaFiscal,
  listInvoices,
  markSent,
  pdfFilename,
  renderInvoicePdf,
  removeNotaFiscalAttachment,
  revertToDraft,
  refreshPartyDetails,
  saveNfseDescription,
  saveCustomText,
  savedTextFor,
  selectDraftPdfTemplate,
  saveNotes,
  SequenceOverrideUnavailableError,
  updateItem,
  type NotaFiscalUpload,
} from "./invoices.service.ts";
import { LiquidSourceError } from "../text-generators/text-generators.service.ts";
import { attachToInvoiceRecord, createInvoiceRecord, MAX_RECORD_ATTACHMENT_BYTES, recordFile, updateInvoiceRecord } from "../invoice-records/invoice-records.instances.ts";
import { InvoiceRecordsSection } from "../invoice-records/components/invoice-records-section.tsx";
import {
  GotenbergConnectionError,
  GotenbergInvalidPdfError,
  GotenbergInvalidResponseError,
  GotenbergNotConfiguredError,
  GotenbergRequestError,
  GotenbergTimeoutError,
  GotenbergUnavailableError,
} from "../../pdf/html/gotenberg-client.ts";
import { PdfRendererUnavailableError } from "../../pdf/renderer.ts";
import { InvalidGotenbergConfigError } from "../../config/gotenberg.ts";
import {
  PdfEngineNotConfiguredError,
  PdfTemplateArchivedError,
  PdfTemplateNotFoundError,
} from "../pdf-templates/pdf-templates.service.ts";
import {
  getGotenbergStatus,
  htmlRenderingBlockedReason,
} from "../pdf-templates/pdf-engine-status.ts";
import { absolutePath } from "../files/files.service.ts";
import {
  emptyItemFormValues,
  invoiceFormValuesFromBody,
  itemFormValuesFromBody,
  itemFormValuesFromRow,
} from "./invoices.view.ts";
import { InvoiceWorkspaceEditor } from "./components/invoice-workspace.tsx";
import { cancelEditSessionSchema, commandSchema, createEditSessionSchema, generatorPreviewSchema, pdfPreviewSchema, rebaseSchema, workspaceSaveEnvelopeSchema } from "./invoice-workspace.schema.ts";
import { cancelEditSession, createEditSession, createSavedDataPreview, executeWorkspaceCommand, generateWorkspaceCandidate, getPreviewFile, operationResult, rebaseResult, rebaseWorkspace, saveWorkspace, stageWorkspaceFile } from "./invoice-workspace.service.ts";
import { WorkspaceConflictError, WorkspaceValidationError } from "../../domain/invoice-workspace.ts";
import { PageHeader } from "../../web/components/page-header.tsx";

export const invoicesRoutes = new Hono();

// Retire every former per-card mutation entry point. They cannot participate
// in the workspace revision/receipt protocol and therefore fail before body
// parsing, uploads, rendering, or writes. Read/download compatibility remains.
invoicesRoutes.use("*", async (c, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(c.req.method)) return next();
  const match = /^\/invoices\/(\d+)(\/.*)?$/.exec(c.req.path);
  if (!match) return next();
  const suffix = match[2] ?? "";
  if (/^\/(?:edit-sessions(?:\/|$)|edit-operations$|commands\/|previews(?:\/|$))/.test(suffix)) return next();
  c.status(409);
  return c.html(<div role="alert" class="alert alert-warning" data-workspace-outcome="rejected" data-workspace-result={JSON.stringify({ outcome:"rejected",code:"STALE_CLIENT",message:"This older save control is no longer accepted. Reopen the invoice editor so all changes use one revision-checked operation." })}>This older save control is no longer accepted. <a class="link" href={`/invoices/${match[1]}/edit`}>Reopen the invoice editor</a>.</div>);
});

invoicesRoutes.get("/", (c) =>
  c.render(<InvoicesListPage invoices={listInvoices()} />, { title: "Invoices" }),
);

// Quick invoice (step one): choose the client, then jump into its composer.
invoicesRoutes.get("/new", (c) =>
  c.render(
    <PickClientPage
      clients={listClients()}
      stats={clientInvoiceStats()}
      defaultClientId={getDefaultClient()?.id ?? null}
    />,
    { title: "New invoice" },
  ),
);

invoicesRoutes.post("/", async (c) => {
  const body = (await c.req.parseBody()) as FormBody;
  const parsed = createInvoiceSchema.safeParse(body);

  if (!parsed.success) {
    return renderInvoiceFormError(c, body, fieldErrorsFromZod(parsed.error));
  }

  try {
    const invoice = createInvoice(parsed.data);
    c.header("HX-Redirect", `/invoices/${invoice.id}`);
    return c.body(null, 201);
  } catch (err) {
    if (err instanceof InvoiceNumberTakenError) {
      return renderInvoiceFormError(c, body, {
        manualNumber: "That invoice number is already in use",
        sequenceOverride: "That invoice number is already in use",
        _form: "That invoice number is already in use",
      });
    }
    if (err instanceof InvoiceNumberRequiredError) {
      return renderInvoiceFormError(c, body, {
        manualNumber: "Enter a number — this client has no numbering profile",
      });
    }
    if (err instanceof ClientNotFoundError) {
      return renderInvoiceFormError(c, body, { clientId: "Select a client" });
    }
    if (err instanceof SequenceOverrideUnavailableError) {
      return renderInvoiceFormError(c, body, {
        sequenceOverride: "This profile does not use a sequence token",
      });
    }
    if (
      err instanceof PdfEngineNotConfiguredError ||
      err instanceof PdfTemplateArchivedError ||
      err instanceof PdfTemplateNotFoundError
    ) {
      return renderInvoiceFormError(c, body, {
        pdfTemplateId: err.message,
        _form: "Choose an available PDF template.",
      });
    }
    throw err;
  }
});

invoicesRoutes.get("/:id", async (c) => {
  const detail = detailFromParam(c.req.param("id"));
  if (!detail) {
    // Keep the command receipt checker mounted after a deleted invoice reload.
    c.status(404);
    return c.render(<div><h1 class="text-xl font-semibold">Invoice unavailable</h1><div id="invoice-command-result" class="mt-4" aria-live="polite"/><a class="btn btn-ghost mt-4" href="/invoices">Back to invoices</a></div>, { title: "Invoice unavailable" });
  }

  // Auto-fill the nota fiscal text from the template when none is saved yet, so
  // the user never has to click "generate" first (it still needs an explicit
  // Save to persist).
  const savedOutput = savedTextFor(detail, "nfse_description");
  const saved = savedOutput?.content ?? detail.invoice.nfseDescription;
  const nfseGenerator = detail.textGenerators.find(
    (generator) => generator.purpose === "nfse-description",
  );
  let nfse: { value: string; autofilled: boolean; error?: string; sourceSnapshot?: string } = {
    value: saved ?? "",
    autofilled: false,
    sourceSnapshot: savedOutput?.sourceSnapshot ?? nfseGenerator?.source,
  };
  if (saved == null) {
    try {
      const value = generateNfseDescription(detail);
      nfse = { value, autofilled: value.trim() !== "", sourceSnapshot: nfseGenerator?.source };
    } catch (error) {
      if (error instanceof LiquidSourceError) {
        nfse = { value: "", autofilled: false, error: error.message };
      } else throw error;
    }
  }

  return c.render(
    <InvoiceDetailPage
      detail={detail}
      pdfFilename={pdfFilename(detail)}
      nfse={nfse}
      pdfRenderBlockedReason={await pdfRenderBlockedReason(detail)}
    />,
    { title: detail.invoice.number },
  );
});

invoicesRoutes.get("/:id/edit", (c) => {
  const detail = detailFromParam(c.req.param("id")); if (!detail) return c.notFound();
  return c.render(<div><PageHeader title={`Edit ${detail.invoice.number}`} description={`${detail.client.name} · one editing session`} actions={<a href={`/invoices/${detail.invoice.id}`} class="btn btn-ghost btn-sm">Review current invoice</a>}/><InvoiceWorkspaceEditor detail={detail}/></div>, { title: `Edit ${detail.invoice.number}` });
});

invoicesRoutes.post("/:id/edit-sessions", async (c) => {
  const invoiceId = numericId(c.req.param("id")); if (!invoiceId || !getInvoiceDetail(invoiceId)) return c.notFound();
  const parsed = createEditSessionSchema.safeParse(await workspaceJson(c)); if (!parsed.success) return workspaceError(c, 422, "INVALID_ENVELOPE", "The editing session request is invalid.");
  try { const result = createEditSession(invoiceId, parsed.data.editSessionId, parsed.data.desiredBaseRevision); return c.html(<WorkspaceOutcome outcome="ready" data={result}/>); } catch (error) { return workspaceException(c, error); }
});

invoicesRoutes.post("/:id/edit-operations", async (c) => {
  const invoiceId = numericId(c.req.param("id")); if (!invoiceId || !getInvoiceDetail(invoiceId)) return c.notFound();
  const raw = await workspaceJson(c); const parsed = workspaceSaveEnvelopeSchema.safeParse(raw);
  if (!parsed.success) return workspaceError(c, 422, "INVALID_ENVELOPE", "No changes saved. The save payload was invalid.", parsed.error.issues.map(issue => ({ path: issue.path.join("."), label: issue.path.at(-1)?.toString() ?? "Field", message: issue.message, section: sectionForPath(issue.path.join(".")) })));
  try { const result = saveWorkspace(invoiceId, parsed.data); return c.html(<WorkspaceOutcome outcome={result.outcome} data={result}/>, result.outcome === "rejected" ? result.code === "VALIDATION" ? 422 : 409 : result.outcome === "processing" ? 202 : 200); } catch (error) { return workspaceException(c, error); }
});

invoicesRoutes.get("/:id/operations/:operation", (c) => {
  const invoiceId = numericId(c.req.param("id")); if (!invoiceId) return c.notFound(); const result = operationResult(invoiceId, c.req.param("operation"));
  if (!result) return c.html(<WorkspaceOutcome outcome="unknown" data={{ outcome:"unknown", message:"No operation with this identity was found." }}/>, 404);
  return c.html(<WorkspaceOutcome outcome={result.outcome} data={result}/>, result.outcome === "processing" ? 202 : 200);
});

invoicesRoutes.post("/:id/edit-sessions/:session/rebase", async (c) => {
  const invoiceId = numericId(c.req.param("id")); if (!invoiceId) return c.notFound(); const parsed = rebaseSchema.safeParse(await workspaceJson(c));
  if (!parsed.success || parsed.data.editSessionId !== c.req.param("session")) return workspaceError(c, 422, "INVALID_ENVELOPE", "The rebase request is invalid.");
  try { return c.html(<WorkspaceOutcome outcome="committed" data={rebaseWorkspace(invoiceId, parsed.data)}/>); } catch (error) { return workspaceException(c, error); }
});

invoicesRoutes.get("/:id/edit-sessions/:session/rebases/:rebase", (c) => {
  const invoiceId = numericId(c.req.param("id")); if (!invoiceId) return c.notFound(); const result = rebaseResult(invoiceId, c.req.param("session"), c.req.param("rebase"));
  if (result === null) return workspaceError(c, 410, "SESSION_EXPIRED", "This editing session is no longer available.");
  if (result === undefined) return c.html(<WorkspaceOutcome outcome="unknown" data={{ outcome:"unknown",message:"The rebase result is not available yet." }}/>,404);
  return c.html(<WorkspaceOutcome outcome={result.outcome} data={result}/>);
});

invoicesRoutes.post("/:id/edit-sessions/:session/cancel", async (c) => {
  const invoiceId = numericId(c.req.param("id")); if (!invoiceId) return c.notFound(); const parsed = cancelEditSessionSchema.safeParse(await workspaceJson(c)); if (!parsed.success) return workspaceError(c,422,"INVALID_ENVELOPE","The cancel request is invalid.");
  try { return c.html(<WorkspaceOutcome outcome="cancelled" data={cancelEditSession(invoiceId,c.req.param("session"),parsed.data.baseGeneration)}/>); } catch(error) { return workspaceException(c,error); }
});

invoicesRoutes.post("/:id/edit-sessions/:session/staged-files", async (c) => {
  const invoiceId = numericId(c.req.param("id")); if (!invoiceId) return c.notFound(); const body = await c.req.parseBody(); const file = body.file;
  if (!(file instanceof File)) return workspaceError(c,422,"FILE_REQUIRED","Choose a file.");
  try { const staged = await stageWorkspaceFile(invoiceId,c.req.param("session"),formString(body.uploadId),formString(body.recordKey),formString(body.definitionKey),file); return c.html(<WorkspaceOutcome outcome="ready" data={{ outcome:"ready",token:staged.token,uploadId:staged.uploadId,digest:staged.digest,message:"File staged for Save changes." }}/>); } catch(error) { return workspaceException(c,error); }
});

invoicesRoutes.post("/:id/edit-sessions/:session/preview/generate", async (c) => {
  const invoiceId=numericId(c.req.param("id"));if(!invoiceId)return c.notFound();const parsed=generatorPreviewSchema.safeParse(await workspaceJson(c));if(!parsed.success)return workspaceError(c,422,"INVALID_ENVELOPE","The generation preview request is invalid.");
  try{return c.html(<WorkspaceOutcome outcome="ready" data={generateWorkspaceCandidate(invoiceId,c.req.param("session"),parsed.data)}/>);}catch(error){return workspaceException(c,error);}
});

invoicesRoutes.post("/:id/commands/:kind", async(c)=>{
  const invoiceId=numericId(c.req.param("id"));if(!invoiceId)return c.notFound();const parsed=commandSchema.safeParse(await workspaceJson(c));if(!parsed.success||parsed.data.kind!==c.req.param("kind"))return workspaceError(c,422,"INVALID_ENVELOPE","The invoice command is invalid.");
  try{const result=await executeWorkspaceCommand(invoiceId,parsed.data);return c.html(<WorkspaceOutcome outcome={result.outcome} data={result}/>,result.outcome==="processing"?202:result.outcome==="rejected"?409:200);}catch(error){return workspaceException(c,error);}
});

invoicesRoutes.post("/:id/previews",async(c)=>{const invoiceId=numericId(c.req.param("id"));if(!invoiceId)return c.notFound();const parsed=pdfPreviewSchema.safeParse(await workspaceJson(c));if(!parsed.success)return workspaceError(c,422,"INVALID_ENVELOPE","The PDF preview request is invalid.");try{return c.html(<WorkspaceOutcome outcome="ready" data={await createSavedDataPreview(invoiceId,parsed.data)}/>);}catch(error){const failure=pdfRenderFailure(error);if(failure)return workspaceError(c,failure.status,"RENDER_FAILED",failure.message);return workspaceException(c,error);}});

invoicesRoutes.get("/:id/previews/:preview",async(c)=>{const invoiceId=numericId(c.req.param("id"));if(!invoiceId)return c.notFound();const owned=getPreviewFile(invoiceId,c.req.param("preview"));if(!owned)return workspaceError(c,410,"PREVIEW_EXPIRED","This PDF preview expired. Generate a new preview explicitly.");const path=absolutePath(owned.file);if(!existsSync(path))return c.notFound();c.header("Content-Type","application/pdf");c.header("Content-Disposition",contentDisposition(`invoice-preview-${owned.preview.id}.pdf`));return c.body(await Bun.file(path).arrayBuffer());});

invoicesRoutes.post("/:id/status", async (c) => {
  const detail = detailFromParam(c.req.param("id"));
  if (!detail) return c.notFound();

  const body = (await c.req.parseBody()) as FormBody;
  const parsed = statusSchema.safeParse(body);
  if (!parsed.success) {
    c.status(422);
    return c.html(
      <WorkflowHeader
        invoice={detail.invoice}
        archivedPdf={detail.archivedPdf}
        error="Invalid status."
      />,
    );
  }

  try {
    const updated = changeStatus(detail.invoice.id, parsed.data.status);
    return c.html(
      <>
        <WorkflowHeader invoice={updated} archivedPdf={detail.archivedPdf} />
        <InvoiceHeaderStatus status={updated.status as InvoiceStatus} oob />
      </>,
    );
  } catch (err) {
    if (err instanceof InvalidStatusTransitionError) {
      c.status(422);
      return c.html(
        <WorkflowHeader
          invoice={detail.invoice}
          archivedPdf={detail.archivedPdf}
          error={`Can't move from ${err.from} to ${err.to}.`}
        />,
      );
    }
    throw err;
  }
});

// Issue: archive the PDF and lock the document. Reloads the page (the lock
// state changes across the whole view), so we redirect rather than swap.
invoicesRoutes.post("/:id/issue", async (c) => {
  const detail = detailFromParam(c.req.param("id"));
  if (!detail) return c.notFound();

  try {
    await issueInvoice(detail);
    c.header("HX-Redirect", `/invoices/${detail.invoice.id}`);
    return c.body(null, 200);
  } catch (err) {
    if (err instanceof EmptyInvoiceError) {
      c.status(422);
      return c.html(
        <WorkflowHeader
          invoice={detail.invoice}
          archivedPdf={detail.archivedPdf}
          error="Add at least one item before issuing."
        />,
      );
    }
    if (err instanceof InvalidStatusTransitionError) {
      c.status(422);
      return c.html(
        <WorkflowHeader
          invoice={detail.invoice}
          archivedPdf={detail.archivedPdf}
          error="This invoice can no longer be issued."
        />,
      );
    }
    const failure = pdfRenderFailure(err);
    if (failure) {
      c.status(failure.status);
      return c.html(
        <WorkflowHeader
          invoice={detail.invoice}
          archivedPdf={detail.archivedPdf}
          error={failure.message}
          renderBlockedReason={failure.message}
        />,
      );
    }
    throw err;
  }
});

// Revert to draft: unlock editing. Also reloads the page.
invoicesRoutes.post("/:id/revert", (c) => {
  const detail = detailFromParam(c.req.param("id"));
  if (!detail) return c.notFound();

  try {
    revertToDraft(detail.invoice.id);
    c.header("HX-Redirect", `/invoices/${detail.invoice.id}`);
    return c.body(null, 200);
  } catch (err) {
    if (err instanceof InvalidStatusTransitionError) {
      c.status(422);
      return c.html(
        <WorkflowHeader
          invoice={detail.invoice}
          archivedPdf={detail.archivedPdf}
          error="This invoice is already a draft."
        />,
      );
    }
    throw err;
  }
});

// Edit a draft's number/date. Reloads the page on success (the values feed the
// PDF filename, page title, and templates); returns the fragment with errors on
// validation failure.
invoicesRoutes.post("/:id/doc", async (c) => {
  const detail = detailFromParam(c.req.param("id"));
  if (!detail) return c.notFound();

  const body = (await c.req.parseBody()) as FormBody;
  const parsed = editInvoiceDocSchema.safeParse(body);
  if (!parsed.success) {
    c.status(422);
    return c.html(
      <InvoiceDocFields
        invoice={detail.invoice}
        errors={fieldErrorsFromZod(parsed.error)}
      />,
    );
  }

  try {
    updateInvoiceDoc(detail.invoice.id, parsed.data);
    c.header("HX-Redirect", `/invoices/${detail.invoice.id}`);
    return c.body(null, 200);
  } catch (err) {
    if (err instanceof InvoiceNumberTakenError) {
      c.status(422);
      return c.html(
        <InvoiceDocFields
          invoice={detail.invoice}
          errors={{ number: "That invoice number is already in use" }}
        />,
      );
    }
    if (err instanceof DocumentLockedError) {
      c.status(409);
      return c.html(<InvoiceDocFields invoice={detail.invoice} />);
    }
    throw err;
  }
});

// Delete a draft invoice (confirmed in the UI). Redirects to the list.
invoicesRoutes.delete("/:id", (c) => {
  const detail = detailFromParam(c.req.param("id"));
  if (!detail) return c.notFound();

  try {
    deleteInvoice(detail.invoice.id);
    c.header("HX-Redirect", "/invoices");
    return c.body(null, 200);
  } catch (err) {
    if (err instanceof DocumentLockedError) {
      c.status(409);
      return c.html(
        <WorkflowHeader
          invoice={detail.invoice}
          archivedPdf={detail.archivedPdf}
          error="Only draft invoices can be deleted. Revert to draft first."
        />,
      );
    }
    throw err;
  }
});

invoicesRoutes.post("/:id/notes", async (c) => {
  const detail = detailFromParam(c.req.param("id"));
  if (!detail) return c.notFound();

  const body = (await c.req.parseBody()) as FormBody;
  const parsed = notesSchema.safeParse(body);
  if (!parsed.success) {
    c.status(422);
    return c.html(
      <NotesEditor invoiceId={detail.invoice.id} notes={detail.invoice.notes ?? ""} />,
    );
  }

  const updated = saveNotes(detail.invoice.id, parsed.data.notes);
  return c.html(
    <NotesEditor invoiceId={updated.id} notes={updated.notes ?? ""} saved />,
  );
});

// --- nota fiscal description ---------------------------------------------

invoicesRoutes.post("/:id/records", async (c) => {
  const detail = detailFromParam(c.req.param("id"));
  if (!detail) return c.notFound();
  const body = (await c.req.parseBody()) as FormBody;
  const recordTypeId = Number(formString(body.recordTypeId));
  try { createInvoiceRecord(detail, recordTypeId, {}); return renderInvoiceRecords(c, detail.invoice.id, "Record added."); }
  catch (error) { return renderInvoiceRecords(c, detail.invoice.id, undefined, errorMessage(error)); }
});

invoicesRoutes.post("/:id/records/:recordId", async (c) => {
  const detail = detailFromParam(c.req.param("id"));
  if (!detail) return c.notFound();
  const recordId = Number(c.req.param("recordId"));
  const body = (await c.req.parseBody()) as FormBody;
  const values: Record<string, string | boolean> = {};
  for (const [key, value] of Object.entries(body)) if (key.startsWith("value_")) values[key.slice(6)] = value instanceof File ? "" : value;
  const record = detail.records.find((item) => item.id === recordId);
  for (const definition of record?.definitions.fields ?? []) if (definition.kind === "boolean") values[definition.key] = body[`value_${definition.key}`] === "on";
  try { updateInvoiceRecord(detail, recordId, values); return renderInvoiceRecords(c, detail.invoice.id, "Information saved."); }
  catch (error) { return renderInvoiceRecords(c, detail.invoice.id, undefined, errorMessage(error), { recordId, values }); }
});

invoicesRoutes.post("/:id/records/:recordId/attachments/:definitionKey", async (c) => {
  const detail = detailFromParam(c.req.param("id"));
  if (!detail) return c.notFound();
  const body = await c.req.parseBody();
  const upload = body.file;
  if (!(upload instanceof File) || upload.size === 0) return renderInvoiceRecords(c, detail.invoice.id, undefined, "Choose a file to upload.");
  if (upload.size > MAX_RECORD_ATTACHMENT_BYTES) return renderInvoiceRecords(c, detail.invoice.id, undefined, "Attachments must be 10 MiB or smaller.");
  try { await attachToInvoiceRecord(detail, Number(c.req.param("recordId")), c.req.param("definitionKey"), upload); return renderInvoiceRecords(c, detail.invoice.id, "Attachment saved."); }
  catch (error) { return renderInvoiceRecords(c, detail.invoice.id, undefined, errorMessage(error)); }
});

invoicesRoutes.get("/:id/records/files/:fileId", (c) => {
  const detail = detailFromParam(c.req.param("id"));
  if (!detail) return c.notFound();
  const file = recordFile(detail, Number(c.req.param("fileId")));
  if (!file) return c.notFound();
  c.header("Content-Type", file.mimeType ?? "application/octet-stream");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Content-Disposition", contentDisposition(file.originalFilename ?? file.storedPath.split("/").pop() ?? "file"));
  return c.body(Bun.file(absolutePath(file)).stream());
});

invoicesRoutes.post("/:id/nfse/generate", (c) => {
  const detail = detailFromParam(c.req.param("id"));
  if (!detail) return c.notFound();
  try {
    return c.html(
      <NfseSection
        invoiceId={detail.invoice.id}
        value={generateNfseDescription(detail)}
        hasTemplate={hasNfseGenerator(detail)}
        generated
        sourceSnapshot={detail.textGenerators.find((generator) => generator.purpose === "nfse-description")?.source}
      />,
    );
  } catch (error) {
    if (error instanceof LiquidSourceError) {
      c.status(422);
      return c.html(
        <NfseSection
          invoiceId={detail.invoice.id}
          value={savedTextFor(detail, "nfse_description")?.content ?? detail.invoice.nfseDescription ?? ""}
          hasTemplate={hasNfseGenerator(detail)}
          error={error.message}
          sourceSnapshot={savedTextFor(detail, "nfse_description")?.sourceSnapshot}
        />,
      );
    }
    throw error;
  }
});

invoicesRoutes.post("/:id/nfse", async (c) => {
  const detail = detailFromParam(c.req.param("id"));
  if (!detail) return c.notFound();

  const body = (await c.req.parseBody()) as FormBody;
  const savedText = saveNfseDescription(
    detail.invoice.id,
    typeof body.nfseDescription === "string" ? body.nfseDescription : "",
    formString(body.sourceSnapshot) || undefined,
  );
  return c.html(
    <NfseSection
      invoiceId={detail.invoice.id}
      value={savedText.content}
      hasTemplate={hasNfseGenerator(detail)}
      saved
      sourceSnapshot={
        savedText.sourceSnapshot
      }
    />,
  );
});

invoicesRoutes.post("/:id/generated-texts/:key/generate", (c) => {
  const detail = detailFromParam(c.req.param("id"));
  if (!detail) return c.notFound();
  const key = generatorKeyFromParam(c.req.param("key"));
  if (!key) return c.notFound();
  const generator = detail.textGenerators.find(
    (candidate) => candidate.key === key && candidate.purpose === "custom",
  );
  if (!generator) return c.notFound();
  try {
    const generated = generateCustomText(detail, key);
    return c.html(
      <GeneratedTextCard
        invoiceId={detail.invoice.id}
        generator={generated.generator}
        value={generated.content}
        generated
        sourceSnapshot={generated.generator.source}
      />,
    );
  } catch (error) {
    if (error instanceof LiquidSourceError) {
      c.status(422);
      return c.html(
        <GeneratedTextCard
          invoiceId={detail.invoice.id}
          generator={generator}
          value={savedTextFor(detail, key)?.content ?? ""}
          error={error.message}
          sourceSnapshot={savedTextFor(detail, key)?.sourceSnapshot ?? generator.source}
        />,
      );
    }
    throw error;
  }
});

invoicesRoutes.post("/:id/generated-texts/:key", async (c) => {
  const detail = detailFromParam(c.req.param("id"));
  if (!detail) return c.notFound();
  const key = generatorKeyFromParam(c.req.param("key"));
  if (!key) return c.notFound();
  const generator = detail.textGenerators.find(
    (candidate) => candidate.key === key && candidate.purpose === "custom",
  );
  if (!generator) return c.notFound();
  const body = (await c.req.parseBody()) as FormBody;
  const content = formString(body.content).slice(0, 100_000);
  const saved = saveCustomText(
    detail,
    key,
    content,
    formString(body.sourceSnapshot) || undefined,
  );
  return c.html(
    <GeneratedTextCard
      invoiceId={detail.invoice.id}
      generator={generator}
      value={saved.content}
      saved
      sourceSnapshot={saved.sourceSnapshot}
    />,
  );
});

// --- PDF, archive, and nota fiscal link (Phase 5) ------------------------

invoicesRoutes.get("/:id/pdf", async (c) => {
  const detail = detailFromParam(c.req.param("id"));
  if (!detail) return c.notFound();

  try {
    const { buffer, filename } = await renderInvoicePdf(detail);
    c.header("Content-Type", "application/pdf");
    c.header("Content-Disposition", contentDisposition(filename));
    return c.body(
      buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      ) as ArrayBuffer,
    );
  } catch (error) {
    const failure = pdfRenderFailure(error);
    if (failure) return c.text(failure.message, failure.status);
    throw error;
  }
});

invoicesRoutes.post("/:id/archive", async (c) => {
  const detail = detailFromParam(c.req.param("id"));
  if (!detail) return c.notFound();

  try {
    await archiveInvoicePdf(detail);
    const updated = reload(detail.invoice.id);
    return c.html(
      <PdfSection
        invoice={updated.invoice}
        archivedPdf={updated.archivedPdf}
        filename={pdfFilename(updated)}
        currentTemplate={updated.pdfTemplate}
        templates={updated.pdfTemplateOptions}
        archived
      />,
    );
  } catch (error) {
    const failure = pdfRenderFailure(error);
    if (!failure) throw error;
    c.status(failure.status);
    return c.html(
      <PdfSection
        invoice={detail.invoice}
        archivedPdf={detail.archivedPdf}
        filename={pdfFilename(detail)}
        currentTemplate={detail.pdfTemplate}
        templates={detail.pdfTemplateOptions}
        renderError={failure.message}
        renderBlockedReason={failure.message}
      />,
    );
  }
});

invoicesRoutes.post("/:id/refresh-party-details", async (c) => {
  const detail = detailFromParam(c.req.param("id"));
  if (!detail) return c.notFound();
  try {
    refreshPartyDetails(detail.invoice.id);
    const updated = reload(detail.invoice.id);
    return c.html(<PdfSection invoice={updated.invoice} archivedPdf={updated.archivedPdf} filename={pdfFilename(updated)} currentTemplate={updated.pdfTemplate} templates={updated.pdfTemplateOptions} renderBlockedReason={await pdfRenderBlockedReason(updated)} />);
  } catch (err) {
    if (err instanceof DocumentLockedError) return c.text(err.message, 422);
    throw err;
  }
});

invoicesRoutes.post("/:id/pdf-template", async (c) => {
  const detail = detailFromParam(c.req.param("id"));
  if (!detail) return c.notFound();
  const body = (await c.req.parseBody()) as FormBody;
  const parsed = pdfTemplateSelectionSchema.safeParse(body);
  if (!parsed.success) {
    c.status(422);
    return c.html(
      <PdfSection
        invoice={detail.invoice}
        archivedPdf={detail.archivedPdf}
        filename={pdfFilename(detail)}
        currentTemplate={detail.pdfTemplate}
        templates={detail.pdfTemplateOptions}
        templateError="Select a PDF template."
      />,
    );
  }
  try {
    const updated = selectDraftPdfTemplate(detail, parsed.data.templateId);
    return c.html(
      <PdfSection
        invoice={updated.invoice}
        archivedPdf={updated.archivedPdf}
        filename={pdfFilename(updated)}
        currentTemplate={updated.pdfTemplate}
        templates={updated.pdfTemplateOptions}
        renderBlockedReason={await pdfRenderBlockedReason(updated)}
      />,
    );
  } catch (error) {
    if (error instanceof DocumentLockedError || error instanceof PdfEngineNotConfiguredError) {
      c.status(error instanceof DocumentLockedError ? 409 : 422);
      return c.html(
        <PdfSection
          invoice={detail.invoice}
          archivedPdf={detail.archivedPdf}
          filename={pdfFilename(detail)}
          currentTemplate={detail.pdfTemplate}
          templates={detail.pdfTemplateOptions}
          templateError={error.message}
        />,
      );
    }
    throw error;
  }
});

invoicesRoutes.post("/:id/pdf/archive-download", async (c) => {
  const detail = detailFromParam(c.req.param("id"));
  if (!detail) return c.notFound();

  try {
    const archived = await archiveInvoicePdf(detail);
    c.header("Content-Type", archived.mimeType ?? "application/pdf");
    c.header("Content-Disposition", contentDisposition(pdfFilename(detail)));
    return c.body(Bun.file(absolutePath(archived)).stream());
  } catch (error) {
    const failure = pdfRenderFailure(error);
    if (failure) return c.text(failure.message, failure.status);
    throw error;
  }
});

invoicesRoutes.post("/:id/nfse-link", async (c) => {
  const detail = detailFromParam(c.req.param("id"));
  if (!detail) return c.notFound();

  // The "mark as sent" toggle is only offered on the first link from `issued`.
  const offerMarkSent =
    detail.notaFiscal === null && detail.invoice.status === "issued";

  const body = (await c.req.parseBody()) as FormBody;
  const parsed = notaFiscalLinkSchema.safeParse(body);
  if (!parsed.success) {
    c.status(422);
    return c.html(
      <NfseLinkSection
        invoiceId={detail.invoice.id}
        link={detail.notaFiscal}
        pdfFile={detail.notaFiscalPdf}
        xmlFile={detail.notaFiscalXml}
        errors={fieldErrorsFromZod(parsed.error)}
        offerMarkSent={offerMarkSent}
      />,
    );
  }

  const uploads = {
    pdf: await uploadFrom(body.pdf),
    xml: await uploadFrom(body.xml),
  };
  const updated = linkNotaFiscal(detail, parsed.data, {
    pdf: uploads.pdf,
    xml: uploads.xml,
  });

  // Advancing to "sent" changes the workflow header too, so reload the page.
  if (offerMarkSent && parsed.data.markSent) {
    markSent(updated.invoice.id);
    c.header("HX-Redirect", `/invoices/${updated.invoice.id}`);
    return c.body(null, 200);
  }

  return c.html(
    <NfseLinkSection
      invoiceId={updated.invoice.id}
      link={updated.notaFiscal}
      pdfFile={updated.notaFiscalPdf}
      xmlFile={updated.notaFiscalXml}
      saved
      uploadedPdf={Boolean(uploads.pdf)}
      uploadedXml={Boolean(uploads.xml)}
    />,
  );
});

invoicesRoutes.delete("/:id/nfse-link/:attachment", (c) => {
  const detail = detailFromParam(c.req.param("id"));
  if (!detail) return c.notFound();

  const attachment = c.req.param("attachment");
  if (attachment !== "pdf" && attachment !== "xml") return c.notFound();

  const updated = removeNotaFiscalAttachment(detail, attachment);
  return c.html(
    <NfseLinkSection
      invoiceId={updated.invoice.id}
      link={updated.notaFiscal}
      pdfFile={updated.notaFiscalPdf}
      xmlFile={updated.notaFiscalXml}
      saved
      removedPdf={attachment === "pdf"}
      removedXml={attachment === "xml"}
    />,
  );
});

invoicesRoutes.get("/:id/files/:fileId", (c) => {
  const detail = detailFromParam(c.req.param("id"));
  if (!detail) return c.notFound();

  const fileId = Number(c.req.param("fileId"));
  if (!Number.isInteger(fileId) || fileId <= 0) return c.notFound();

  const file = getInvoiceFile(detail, fileId);
  if (!file) return c.notFound();

  c.header("Content-Type", file.mimeType ?? "application/octet-stream");
  const name = file.originalFilename ?? file.storedPath.split("/").pop() ?? "file";
  c.header("Content-Disposition", contentDisposition(name));
  return c.body(Bun.file(absolutePath(file)).stream());
});

// --- items ---------------------------------------------------------------

invoicesRoutes.get("/:id/items", (c) => {
  const detail = detailFromParam(c.req.param("id"));
  if (!detail) return c.notFound();
  return c.html(renderItems(detail));
});

invoicesRoutes.get("/:id/items/:itemId/edit", (c) => {
  const detail = detailFromParam(c.req.param("id"));
  if (!detail) return c.notFound();
  if (!isDocumentEditable(detail.invoice.status)) {
    return c.html(renderItems(detail));
  }
  const item = itemForInvoice(c.req.param("itemId"), detail.invoice.id);
  if (!item) return c.notFound();
  return c.html(
    renderItems(detail, {
      editingItemId: item.id,
      editValues: itemFormValuesFromRow(item, detail.invoice.currency),
    }),
  );
});

invoicesRoutes.post("/:id/items", async (c) => {
  const detail = detailFromParam(c.req.param("id"));
  if (!detail) return c.notFound();
  if (!isDocumentEditable(detail.invoice.status)) {
    c.status(409);
    return c.html(renderItems(detail));
  }

  const body = (await c.req.parseBody()) as FormBody;
  const parsed = itemFormSchema.safeParse({
    ...body,
    currency: detail.invoice.currency,
  });

  if (!parsed.success) {
    c.status(422);
    return c.html(
      renderItems(detail, {
        addValues: itemFormValuesFromBody(body),
        addErrors: fieldErrorsFromZod(parsed.error),
      }),
    );
  }

  addItem(detail.invoice.id, parsed.data);
  return c.html(renderItems(reload(detail.invoice.id)));
});

invoicesRoutes.post("/:id/items/:itemId", async (c) => {
  const detail = detailFromParam(c.req.param("id"));
  if (!detail) return c.notFound();
  if (!isDocumentEditable(detail.invoice.status)) {
    c.status(409);
    return c.html(renderItems(detail));
  }
  const item = itemForInvoice(c.req.param("itemId"), detail.invoice.id);
  if (!item) return c.notFound();

  const body = (await c.req.parseBody()) as FormBody;
  const parsed = itemFormSchema.safeParse({
    ...body,
    currency: detail.invoice.currency,
  });

  if (!parsed.success) {
    c.status(422);
    return c.html(
      renderItems(detail, {
        editingItemId: item.id,
        editValues: itemFormValuesFromBody(body),
        editErrors: fieldErrorsFromZod(parsed.error),
      }),
    );
  }

  updateItem(item.id, parsed.data);
  return c.html(renderItems(reload(detail.invoice.id)));
});

invoicesRoutes.delete("/:id/items/:itemId", (c) => {
  const detail = detailFromParam(c.req.param("id"));
  if (!detail) return c.notFound();
  if (!isDocumentEditable(detail.invoice.status)) {
    c.status(409);
    return c.html(renderItems(detail));
  }
  const item = itemForInvoice(c.req.param("itemId"), detail.invoice.id);
  if (!item) return c.notFound();

  deleteItem(item.id);
  return c.html(renderItems(reload(detail.invoice.id)));
});

// --- helpers -------------------------------------------------------------

type ItemsState = {
  editingItemId?: number;
  editValues?: ReturnType<typeof itemFormValuesFromBody>;
  editErrors?: FieldErrors;
  addValues?: ReturnType<typeof itemFormValuesFromBody>;
  addErrors?: FieldErrors;
};

function renderItems(
  detail: NonNullable<ReturnType<typeof getInvoiceDetail>>,
  state: ItemsState = {},
) {
  return (
    <ItemsSection
      invoiceId={detail.invoice.id}
      currency={detail.invoice.currency}
      items={detail.items}
      total={detail.total}
      locked={!isDocumentEditable(detail.invoice.status)}
      editingItemId={state.editingItemId}
      editValues={state.editValues}
      editErrors={state.editErrors}
      addValues={state.addValues ?? emptyItemFormValues()}
      addErrors={state.addErrors}
    />
  );
}

/** Re-read the invoice after a mutation so totals/items reflect the change. */
function reload(id: number) {
  const detail = getInvoiceDetail(id);
  if (!detail) throw new Error(`Invoice ${id} vanished mid-request`);
  return detail;
}

function detailFromParam(raw: string) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return null;
  return getInvoiceDetail(id);
}

function generatorKeyFromParam(raw: string): string | null {
  return /^[a-z][a-z0-9_]{0,63}$/.test(raw) ? raw : null;
}

function hasNfseGenerator(detail: ReturnType<typeof getInvoiceDetail> & {}): boolean {
  return Boolean(
    detail.textGenerators.some((generator) => generator.purpose === "nfse-description") ||
      detail.client.defaultNfseDescriptionTemplate,
  );
}

async function pdfRenderBlockedReason(
  detail: NonNullable<ReturnType<typeof getInvoiceDetail>>,
): Promise<string | undefined> {
  if (detail.pdfTemplate.engine !== "gotenberg-html") return undefined;
  return htmlRenderingBlockedReason(await getGotenbergStatus());
}

type PdfRenderFailure = {
  status: 422 | 502 | 503;
  message: string;
};

function pdfRenderFailure(error: unknown): PdfRenderFailure | null {
  if (
    error instanceof GotenbergNotConfiguredError ||
    error instanceof PdfEngineNotConfiguredError
  ) {
    return {
      status: 503,
      message:
        "HTML PDF rendering is not configured. Set GOTENBERG_URL or choose a React PDF template.",
    };
  }
  if (error instanceof InvalidGotenbergConfigError) {
    return {
      status: 503,
      message: `HTML PDF configuration is invalid: ${error.message}`,
    };
  }
  if (error instanceof GotenbergTimeoutError) {
    return {
      status: 503,
      message: "Gotenberg timed out while rendering this PDF. Check the service and try again.",
    };
  }
  if (
    error instanceof GotenbergConnectionError ||
    error instanceof GotenbergUnavailableError
  ) {
    return {
      status: 503,
      message: "Gotenberg is unavailable. Check the HTML PDF engine connection and try again.",
    };
  }
  if (error instanceof GotenbergRequestError || error instanceof LiquidSourceError) {
    return {
      status: 422,
      message: `The selected HTML template could not be rendered: ${error.message}`,
    };
  }
  if (
    error instanceof GotenbergInvalidResponseError ||
    error instanceof GotenbergInvalidPdfError
  ) {
    return {
      status: 502,
      message: "Gotenberg returned an invalid PDF response. Check its logs and try again.",
    };
  }
  if (error instanceof PdfRendererUnavailableError) {
    return { status: 503, message: error.message };
  }
  return null;
}

function itemForInvoice(raw: string, invoiceId: number) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return null;
  const item = getItem(id);
  return item && item.invoiceId === invoiceId ? item : null;
}

function renderInvoiceRecords(c: Context, invoiceId: number, saved?: string, error?: string, submittedRecord?: { recordId: number; values: Record<string, string | boolean> }) {
  const detail = getInvoiceDetail(invoiceId);
  if (!detail) return c.notFound();
  if (error) c.status(422);
  return c.html(<InvoiceRecordsSection invoiceId={invoiceId} recordTypes={detail.recordTypes} records={detail.records} saved={saved} error={error} submittedRecord={submittedRecord} />);
}

function errorMessage(error: unknown) { return error instanceof Error ? error.message : "The record could not be saved"; }

function numericId(raw: string): number | null { const id = Number(raw); return Number.isInteger(id) && id > 0 ? id : null; }
async function workspaceJson(c: Context): Promise<unknown> { if (c.req.header("content-type")?.includes("application/json")) return c.req.json().catch(() => null); const body = await c.req.parseBody(); const raw = formString(body.workspaceEnvelope); try { return JSON.parse(raw); } catch { return null; } }
function sectionForPath(path: string): "document" | "text" | "records" { return path.startsWith("generatedTexts") || path === "setNotes" ? "text" : path.startsWith("records") || path.startsWith("attachments") || path.startsWith("legacy") ? "records" : "document"; }
function WorkspaceOutcome({ outcome, data }: { outcome: string; data: unknown }) { const value = data as { message?: string; fieldErrors?: Array<{path:string;label:string;message:string}> }; return <div data-workspace-outcome={outcome} data-workspace-result={JSON.stringify({ ...(typeof data === "object" && data ? data : { value:data }), outcome })} role={outcome === "rejected" ? "alert" : "status"} class={outcome === "rejected" ? "alert alert-error my-3" : outcome === "processing" || outcome === "unknown" ? "alert alert-warning my-3" : "alert alert-success my-3"}><div><p>{value.message ?? (outcome === "ready" ? "Editing session ready." : outcome)}</p>{value.fieldErrors?.length ? <ul class="mt-2 list-disc pl-5">{value.fieldErrors.map(error => <li><button type="button" class="link" data-error-path={error.path}>{error.label}: {error.message}</button></li>)}</ul> : null}</div></div>; }
function workspaceError(c: Context, status: number, code: string, message: string, fieldErrors?: Array<{path:string;label:string;message:string;section:"document"|"text"|"records"}>) { c.status(status as any); return c.html(<WorkspaceOutcome outcome="rejected" data={{ outcome:"rejected",code,message,fieldErrors }}/>); }
function workspaceException(c: Context, error: unknown) { if (error instanceof WorkspaceValidationError) return workspaceError(c,422,"VALIDATION",error.message,error.errors); if (error instanceof WorkspaceConflictError) return workspaceError(c,error.code === "SESSION_EXPIRED" ? 410 : 409,error.code,error.message); throw error; }

/**
 * Build a safe `Content-Disposition` header. The filename is ASCII-sanitized
 * for the legacy `filename=` token and UTF-8 percent-encoded for `filename*`.
 */
function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** Read an uploaded file field into bytes, or undefined when none was sent. */
async function uploadFrom(
  field: FormBody[string] | undefined,
): Promise<NotaFiscalUpload | undefined> {
  if (!(field instanceof File) || field.size === 0) return undefined;
  return {
    bytes: new Uint8Array(await field.arrayBuffer()),
    originalFilename: field.name || null,
  };
}

function renderInvoiceFormError(
  c: Context,
  body: FormBody,
  errors: FieldErrors,
) {
  c.status(422);
  const id = Number(formString(body.clientId));
  const client =
    Number.isInteger(id) && id > 0 ? getClientById(id) : null;
  if (!client) {
    return c.html(<Alert kind="error" message="Select a client first." />);
  }
  const ctx = composerContext(client);
  return c.html(
    <InvoiceComposer
      client={client}
      issuer={ctx.issuer}
      values={invoiceFormValuesFromBody(body)}
      currencyDefault={ctx.currencyDefault}
      hasProfile={ctx.hasProfile}
      errors={errors}
      pdfTemplates={ctx.pdfTemplates}
      templateError={ctx.templateError}
    />,
  );
}
