import type { Client } from "../../../db/schema.ts";
import { formatMoney } from "../../../domain/money.ts";

export function ClientsTable({ clients }: { clients: Client[] }) {
  if (clients.length === 0) {
    return (
      <div class="rounded-lg border border-dashed border-base-300 bg-base-100 p-10 text-center">
        <p class="text-sm text-base-content/60">
          No clients yet. Create your first client to start invoicing.
        </p>
        <a href="/clients/new" class="btn btn-primary btn-sm mt-4">
          New client
        </a>
      </div>
    );
  }

  return (
    <div class="overflow-x-auto rounded-lg border border-base-300 bg-base-100">
      <table class="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Code</th>
            <th>Country</th>
            <th class="text-right">Default monthly</th>
          </tr>
        </thead>
        <tbody>
          {clients.map((client) => (
            <tr class="hover">
              <td>
                <a
                  href={`/clients/${client.id}`}
                  class="link link-hover font-medium"
                >
                  {client.name}
                </a>
              </td>
              <td>
                <span class="badge badge-ghost badge-sm font-mono">
                  {client.code}
                </span>
              </td>
              <td class="text-base-content/70">{client.country ?? "—"}</td>
              <td class="text-right tabular-nums">
                {client.defaultFixedMonthlyValue != null
                  ? formatMoney(
                      client.defaultFixedMonthlyValue,
                      client.defaultCurrency,
                    )
                  : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
