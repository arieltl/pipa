import type { Client, NumberingProfile } from "../../db/schema.ts";
import { PageHeader } from "../../web/components/page-header.tsx";
import {
  ClientForm,
  type ClientFormValues,
} from "./components/client-form.tsx";
import { ClientsTable } from "./components/clients-table.tsx";

export function ClientsListPage({ clients }: { clients: Client[] }) {
  return (
    <div>
      <PageHeader
        title="Clients"
        description="Companies you invoice. Defaults here seed new invoices but never change historical ones."
        actions={
          <a href="/clients/new" class="btn btn-primary btn-sm">
            New client
          </a>
        }
      />
      <ClientsTable clients={clients} />
    </div>
  );
}

export function NewClientPage({
  values,
  profiles,
}: {
  values: ClientFormValues;
  profiles: NumberingProfile[];
}) {
  return (
    <div>
      <PageHeader title="New client" />
      <div class="max-w-3xl rounded-lg border border-base-300 bg-base-100 p-6">
        <ClientForm
          action="/clients"
          values={values}
          profiles={profiles}
          submitLabel="Create client"
        />
      </div>
    </div>
  );
}

export function EditClientPage({
  client,
  values,
  profiles,
}: {
  client: Client;
  values: ClientFormValues;
  profiles: NumberingProfile[];
}) {
  return (
    <div>
      <PageHeader
        title={client.name}
        description={`Client ${client.code}`}
        actions={
          <a href="/clients" class="btn btn-ghost btn-sm">
            Back to clients
          </a>
        }
      />
      <div class="max-w-3xl rounded-lg border border-base-300 bg-base-100 p-6">
        <ClientForm
          action={`/clients/${client.id}`}
          values={values}
          profiles={profiles}
          submitLabel="Save changes"
        />
      </div>
    </div>
  );
}
