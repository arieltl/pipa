import { Hono, type Context } from "hono";
import { fieldErrorsFromZod } from "../../web/validation.ts";
import type { FieldErrors } from "../../web/components/forms.tsx";
import type { FormBody } from "../../web/form-values.ts";
import { ClientForm } from "./components/client-form.tsx";
import {
  ClientsListPage,
  EditClientPage,
  NewClientPage,
} from "./clients.pages.tsx";
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

export const clientsRoutes = new Hono();

clientsRoutes.get("/", (c) =>
  c.render(<ClientsListPage clients={listClients()} />, { title: "Clients" }),
);

clientsRoutes.get("/new", (c) =>
  c.render(
    <NewClientPage
      values={emptyClientFormValues()}
      profiles={listNumberingProfiles()}
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
    createClient(parsed.data);
    c.header("HX-Redirect", "/clients");
    return c.body(null, 201);
  } catch (err) {
    if (err instanceof ClientCodeTakenError) {
      return renderClientFormError(c, "/clients", body, {
        code: "That code is already used by another client",
      });
    }
    throw err;
  }
});

clientsRoutes.get("/:id", (c) => {
  const client = getClientFromParam(c.req.param("id"));
  if (!client) return c.notFound();
  return c.render(
    <EditClientPage
      client={client}
      values={clientFormValuesFromRow(client)}
      profiles={listNumberingProfiles()}
    />,
    { title: client.name },
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
    throw err;
  }
});

// --- helpers -------------------------------------------------------------

function getClientFromParam(raw: string) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return null;
  return getClient(id);
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
      submitLabel={submitLabel}
      errors={errors}
    />,
  );
}
