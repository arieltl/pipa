import type { Child } from "hono/jsx";
import { raw } from "hono/html";
import type { Client } from "../db/schema.ts";

export type LayoutProps = {
  title?: string;
  /** Path of the active page, used to highlight the matching nav item. */
  currentPath?: string;
  /** Clients shown in the sidebar workspace switcher. */
  clients?: Client[];
  /** Id of the pinned default client, marked with a star. */
  defaultClientId?: number | null;
  children?: Child;
};

/**
 * Full-page chrome: a persistent left sidebar that doubles as a client
 * workspace switcher. Only wraps non-htmx (full document) responses; htmx
 * fragment responses bypass this entirely (see renderer.tsx).
 */
export function Layout({
  title,
  currentPath,
  clients = [],
  defaultClientId = null,
  children,
}: LayoutProps) {
  const pageTitle = title ? `${title} · Pipa` : "Pipa";
  return (
    <>
      {raw("<!DOCTYPE html>")}
      <html lang="en" data-theme="invoice">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" type="image/svg+xml" href="/public/pipa-logo.svg" />
        <title>{pageTitle}</title>
        <link rel="stylesheet" href="/public/app.css?v=pdf-preview-1" />
        <script src="/public/app.js?v=0.3.1" defer></script>
        <script src="/public/htmx.min.js" defer></script>
        <script src="/public/alpine.min.js" defer></script>
      </head>
      <body
        class="app-shell min-h-screen bg-base-200 text-base-content antialiased"
        x-data="{ nav: false }"
      >
        <div class="flex min-h-screen">
          <Sidebar
            clients={clients}
            defaultClientId={defaultClientId}
            currentPath={currentPath}
          />

          {/* Mobile overlay backdrop */}
          <div
            class="fixed inset-0 z-30 bg-black/40 lg:hidden"
            x-show="nav"
            x-on:click="nav = false"
            x-transition=""
            style="display:none"
          ></div>

          <div class="flex min-w-0 flex-1 flex-col">
            <header class="app-header sticky top-0 z-20 flex items-center gap-3 px-4 py-3 lg:hidden">
              <button
                type="button"
                class="btn btn-ghost btn-sm btn-square"
                x-on:click="nav = true"
                aria-label="Open navigation"
              >
                ☰
              </button>
              <a href="/" class="flex items-center gap-2">
                <img class="h-8 w-10 object-contain" src="/public/pipa-logo.svg" alt="Pipa" />
                <span class="text-sm font-semibold tracking-tight">Pipa</span>
              </a>
            </header>

            <main class="page-enter mx-auto w-full max-w-7xl flex-1 px-4 py-7 sm:py-9">
              {children}
            </main>

            <footer class="border-t border-base-300/70 bg-base-100/45">
              <div class="mx-auto max-w-7xl px-4 py-3 text-xs text-base-content/60">
                Personal Invoicing &amp; Paperwork Assistant
              </div>
            </footer>
          </div>
        </div>
      </body>
      </html>
    </>
  );
}

function Sidebar({
  clients,
  defaultClientId,
  currentPath,
}: {
  clients: Client[];
  defaultClientId: number | null;
  currentPath?: string;
}) {
  const sorted = sortClients(clients, defaultClientId);
  return (
    <aside
      class="app-sidebar fixed inset-y-0 left-0 z-40 flex w-64 -translate-x-full flex-col border-r border-base-300/80 bg-base-100/80 transition-transform lg:static lg:translate-x-0"
      x-bind:class="nav ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'"
    >
      <div class="flex items-center justify-between px-4 py-4">
        <a href="/" class="flex items-center gap-3">
          <img class="h-10 w-12 object-contain" src="/public/pipa-logo.svg" alt="Pipa" />
          <span class="leading-tight">
            <span class="block text-sm font-semibold tracking-tight">Pipa</span>
            <span class="block text-xs text-base-content/70">
              Invoicing workspace
            </span>
          </span>
        </a>
        <button
          type="button"
          class="btn btn-ghost btn-xs btn-square lg:hidden"
          x-on:click="nav = false"
          aria-label="Close navigation"
        >
          ✕
        </button>
      </div>

      <nav class="flex-1 overflow-y-auto px-3 pb-4">
        <NavLink href="/" label="Overview" currentPath={currentPath} exact />

        <div class="mt-5 flex items-center justify-between px-3">
          <span class="text-xs font-semibold uppercase tracking-wide text-base-content/45">
            Clients
          </span>
          <a
            href="/clients/new"
            class="text-xs font-medium text-primary hover:underline"
          >
            + New
          </a>
        </div>
        <ul class="mt-1 space-y-0.5">
          {sorted.length === 0 ? (
            <li class="px-3 py-2 text-xs text-base-content/50">
              No clients yet.
            </li>
          ) : (
            sorted.map((client) => (
              <li>
                <a
                  href={`/clients/${client.id}`}
                  class={navLinkClass(`/clients/${client.id}`, currentPath)}
                >
                  <span class="truncate">{client.name}</span>
                  {client.id === defaultClientId ? (
                    <span class="ml-auto text-amber-400" title="Default client">
                      ★
                    </span>
                  ) : null}
                </a>
              </li>
            ))
          )}
        </ul>

        <div class="mt-5 border-t border-base-300/60 pt-3">
          <NavLink
            href="/settings/issuer"
            label="Issuer settings"
            currentPath={currentPath}
          />
          <NavLink
            href="/settings/numbering"
            label="Numbering profiles"
            currentPath={currentPath}
          />
          <NavLink
            href="/settings/pdf-templates"
            label="PDF templates"
            currentPath={currentPath}
          />
        </div>
      </nav>

      <div class="border-t border-base-300/60 p-3">
        <a href="/invoices/new" class="btn btn-primary btn-sm w-full">
          Quick invoice
        </a>
      </div>
    </aside>
  );
}

function NavLink({
  href,
  label,
  currentPath,
  exact = false,
}: {
  href: string;
  label: string;
  currentPath?: string;
  exact?: boolean;
}) {
  return (
    <a class={navLinkClass(href, currentPath, exact)} href={href}>
      {label}
    </a>
  );
}

function navLinkClass(
  href: string,
  currentPath?: string,
  exact = false,
): string {
  const base =
    "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors";
  return isActive(href, currentPath, exact)
    ? `${base} bg-primary text-primary-content shadow-sm`
    : `${base} text-base-content/82 hover:bg-base-300/55 hover:text-base-content`;
}

function isActive(href: string, currentPath?: string, exact = false): boolean {
  if (!currentPath) return false;
  if (exact || href === "/") return currentPath === href;
  return currentPath === href || currentPath.startsWith(`${href}/`);
}

/** Default client first, then the existing (name-sorted) order. */
function sortClients(clients: Client[], defaultClientId: number | null): Client[] {
  if (defaultClientId == null) return clients;
  const def = clients.filter((c) => c.id === defaultClientId);
  const rest = clients.filter((c) => c.id !== defaultClientId);
  return [...def, ...rest];
}
