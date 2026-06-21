import type { Client, IssuerSettings } from "../../../db/schema.ts";

/** Small uppercase field label used across the invoice document layout. */
export function Caption({ children }: { children: unknown }) {
  return (
    <div class="text-xs font-semibold uppercase tracking-wide text-base-content/45">
      {children as never}
    </div>
  );
}

/** FROM block: the issuer (PJ) details, shared by the composer and detail view. */
export function IssuerBlock({ issuer }: { issuer: IssuerSettings | null }) {
  return (
    <div>
      <Caption>From</Caption>
      {issuer ? (
        <div class="mt-1 space-y-0.5">
          <div class="font-semibold">{issuer.legalName || issuer.name}</div>
          {issuer.cnpj ? (
            <div class="text-sm text-base-content/60">CNPJ {issuer.cnpj}</div>
          ) : null}
          {issuer.address ? (
            <div class="whitespace-pre-line text-sm text-base-content/60">
              {issuer.address}
            </div>
          ) : null}
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
export function ClientBlock({ client }: { client: Client }) {
  return (
    <div>
      <Caption>Bill to</Caption>
      <div class="mt-1 flex items-center gap-2">
        <span class="font-semibold">{client.name}</span>
        <span class="badge badge-sm app-code-badge font-mono">{client.code}</span>
      </div>
      {client.legalName ? (
        <div class="text-sm text-base-content/60">{client.legalName}</div>
      ) : null}
      {client.address ? (
        <div class="whitespace-pre-line text-sm text-base-content/60">
          {client.address}
        </div>
      ) : null}
      {client.country ? (
        <div class="text-sm text-base-content/60">{client.country}</div>
      ) : null}
    </div>
  );
}
