import { Hono, type Context } from "hono";
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
import { NfseLinkSection } from "./components/nfse-link-section.tsx";
import { PdfSection } from "./components/pdf-section.tsx";
import { NotesEditor, WorkflowHeader } from "./components/invoice-detail.tsx";
import {
  InvoiceDetailPage,
  InvoicesListPage,
  PickClientPage,
} from "./invoices.pages.tsx";
import {
  createInvoiceSchema,
  itemFormSchema,
  notaFiscalLinkSchema,
  notesSchema,
  statusSchema,
} from "./invoices.schema.ts";
import { isDocumentEditable } from "../../domain/invoice-status.ts";
import {
  addItem,
  archiveInvoicePdf,
  changeStatus,
  ClientNotFoundError,
  clientInvoiceStats,
  composerContext,
  createInvoice,
  deleteItem,
  EmptyInvoiceError,
  generateNfseDescription,
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
  revertToDraft,
  saveNfseDescription,
  saveNotes,
  updateItem,
  type NotaFiscalUpload,
} from "./invoices.service.ts";
import { absolutePath } from "../files/files.service.ts";
import {
  emptyItemFormValues,
  invoiceFormValuesFromBody,
  itemFormValuesFromBody,
  itemFormValuesFromRow,
} from "./invoices.view.ts";

export const invoicesRoutes = new Hono();

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
    throw err;
  }
});

invoicesRoutes.get("/:id", (c) => {
  const detail = detailFromParam(c.req.param("id"));
  if (!detail) return c.notFound();

  // Auto-fill the nota fiscal text from the template when none is saved yet, so
  // the user never has to click "generate" first (it still needs an explicit
  // Save to persist).
  const saved = detail.invoice.nfseDescription;
  const value = saved ?? generateNfseDescription(detail);
  const nfse = { value, autofilled: saved == null && value.trim() !== "" };

  return c.render(
    <InvoiceDetailPage
      detail={detail}
      pdfFilename={pdfFilename(detail)}
      nfse={nfse}
    />,
    { title: detail.invoice.number },
  );
});

invoicesRoutes.post("/:id/status", async (c) => {
  const detail = detailFromParam(c.req.param("id"));
  if (!detail) return c.notFound();

  const body = (await c.req.parseBody()) as FormBody;
  const parsed = statusSchema.safeParse(body);
  if (!parsed.success) {
    c.status(422);
    return c.html(
      <WorkflowHeader invoice={detail.invoice} error="Invalid status." />,
    );
  }

  try {
    const updated = changeStatus(detail.invoice.id, parsed.data.status);
    return c.html(<WorkflowHeader invoice={updated} />);
  } catch (err) {
    if (err instanceof InvalidStatusTransitionError) {
      c.status(422);
      return c.html(
        <WorkflowHeader
          invoice={detail.invoice}
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
          error="Add at least one item before issuing."
        />,
      );
    }
    if (err instanceof InvalidStatusTransitionError) {
      c.status(422);
      return c.html(
        <WorkflowHeader
          invoice={detail.invoice}
          error="This invoice can no longer be issued."
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
          error="This invoice is already a draft."
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

invoicesRoutes.post("/:id/nfse/generate", (c) => {
  const detail = detailFromParam(c.req.param("id"));
  if (!detail) return c.notFound();
  return c.html(
    <NfseSection
      invoiceId={detail.invoice.id}
      value={generateNfseDescription(detail)}
      hasTemplate={Boolean(detail.client.defaultNfseDescriptionTemplate)}
      generated
    />,
  );
});

invoicesRoutes.post("/:id/nfse", async (c) => {
  const detail = detailFromParam(c.req.param("id"));
  if (!detail) return c.notFound();

  const body = (await c.req.parseBody()) as FormBody;
  const updated = saveNfseDescription(
    detail.invoice.id,
    typeof body.nfseDescription === "string" ? body.nfseDescription : "",
  );
  return c.html(
    <NfseSection
      invoiceId={updated.id}
      value={updated.nfseDescription ?? ""}
      hasTemplate={Boolean(detail.client.defaultNfseDescriptionTemplate)}
      saved
    />,
  );
});

// --- PDF, archive, and nota fiscal link (Phase 5) ------------------------

invoicesRoutes.get("/:id/pdf", async (c) => {
  const detail = detailFromParam(c.req.param("id"));
  if (!detail) return c.notFound();

  const { buffer, filename } = await renderInvoicePdf(detail);
  c.header("Content-Type", "application/pdf");
  c.header("Content-Disposition", contentDisposition(filename));
  return c.body(
    buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    ) as ArrayBuffer,
  );
});

invoicesRoutes.post("/:id/archive", async (c) => {
  const detail = detailFromParam(c.req.param("id"));
  if (!detail) return c.notFound();

  await archiveInvoicePdf(detail);
  const updated = reload(detail.invoice.id);
  return c.html(
    <PdfSection
      invoice={updated.invoice}
      archivedPdf={updated.archivedPdf}
      filename={pdfFilename(updated)}
      archived
    />,
  );
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
        errors={fieldErrorsFromZod(parsed.error)}
        offerMarkSent={offerMarkSent}
      />,
    );
  }

  const updated = linkNotaFiscal(detail, parsed.data, {
    pdf: await uploadFrom(body.pdf),
    xml: await uploadFrom(body.xml),
  });

  // Advancing to "sent" changes the workflow header too, so reload the page.
  if (offerMarkSent && parsed.data.markSent) {
    markSent(updated.invoice.id);
    c.header("HX-Redirect", `/invoices/${updated.invoice.id}`);
    return c.body(null, 200);
  }

  return c.html(
    <NfseLinkSection invoiceId={updated.invoice.id} link={updated.notaFiscal} saved />,
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

function itemForInvoice(raw: string, invoiceId: number) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return null;
  const item = getItem(id);
  return item && item.invoiceId === invoiceId ? item : null;
}

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
    />,
  );
}
