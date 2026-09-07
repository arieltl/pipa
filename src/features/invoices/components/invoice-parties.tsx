import type { Client, IssuerSettings } from "../../../db/schema.ts";
import {
  createPartySnapshot,
  fieldValue,
  type InvoicePartySnapshot,
} from "../../../domain/party-fields/snapshot.ts";

/** Small uppercase field label used across the invoice document layout. */
export function Caption({ children }: { children: unknown }) {
  return (
    <div class="text-xs font-semibold uppercase tracking-wide text-base-content/45">
      {children as never}
    </div>
  );
}

/** FROM block: the issuer (PJ) details, shared by the composer and detail view. */
export function IssuerBlock({
  issuer,
  snapshot,
}: {
  issuer: IssuerSettings | null;
  snapshot?: InvoicePartySnapshot;
}) {
  const party = snapshot ?? (issuer ? createPartySnapshot(issuer) : null);
  return (
    <div>
      <Caption>From</Caption>
      {party ? (
        <div class="mt-1 space-y-0.5">
          <div class="font-semibold">{fieldValue(party.fields, "legal_name") || party.name}</div>
          <PartySummaryFields party={party} omitKeys={["legal_name"]} />
        </div>
      ) : (
        <a href="/settings/issuer" class="link link-hover mt-1 block text-sm">
          Set up your issuer details →
        </a>
      )}
    </div>
  );
}

/** BILL TO block: the client details, shared by the composer and detail view. */
export function ClientBlock({
  client,
  snapshot,
}: {
  client: Client;
  snapshot?: InvoicePartySnapshot;
}) {
  const party = snapshot ?? createPartySnapshot(client);
  return (
    <div>
      <Caption>Bill to</Caption>
      <div class="mt-1 flex items-center gap-2">
        <span class="font-semibold">{fieldValue(party.fields, "legal_name") || party.name}</span>
        <span class="badge badge-sm app-code-badge font-mono">{party.code ?? client.code}</span>
      </div>
      <PartySummaryFields party={party} omitKeys={["legal_name"]} />
    </div>
  );
}

function PartySummaryFields({
  party,
  omitKeys,
}: {
  party: InvoicePartySnapshot;
  omitKeys: string[];
}) {
  const visible = party.fields.filter(
    (field) =>
      !omitKeys.includes(field.key) &&
      (field.section === "identity" ||
        field.section === "contact" ||
        field.section === "address"),
  );
  return (
    <>
      {visible.map((field) => (
        <div class="whitespace-pre-line text-sm text-base-content/60">
          {field.section === "identity" ? `${field.label}: ` : ""}
          {field.value}
        </div>
      ))}
    </>
  );
}
