import type { Child } from "hono/jsx";
import { raw } from "hono/html";

export type NavItem = {
  href: string;
  label: string;
};

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard" },
  { href: "/invoices", label: "Invoices" },
  { href: "/clients", label: "Clients" },
  { href: "/settings/issuer", label: "Settings" },
];

export type LayoutProps = {
  title?: string;
  /** Path of the active page, used to highlight the matching nav item. */
  currentPath?: string;
  children?: Child;
};

/**
 * Full-page chrome. Only wraps non-htmx (full document) responses; htmx
 * fragment responses bypass this entirely (see renderer.tsx).
 */
export function Layout({ title, currentPath, children }: LayoutProps) {
  const pageTitle = title ? `${title} · Invoice` : "Invoice";
  return (
    <>
      {raw("<!DOCTYPE html>")}
      <html lang="en" data-theme="business">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{pageTitle}</title>
        <link rel="stylesheet" href="/public/app.css" />
        <script src="/public/htmx.min.js" defer></script>
        <script src="/public/alpine.min.js" defer></script>
      </head>
      <body class="min-h-screen bg-base-200 text-base-content">
        <div class="flex min-h-screen flex-col">
          <header class="border-b border-base-300 bg-base-100">
            <div class="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
              <a href="/" class="text-lg font-semibold tracking-tight">
                Invoice
              </a>
              <nav class="flex items-center gap-1">
                {NAV_ITEMS.map((item) => (
                  <a
                    href={item.href}
                    class={navLinkClass(item.href, currentPath)}
                  >
                    {item.label}
                  </a>
                ))}
              </nav>
            </div>
          </header>

          <main class="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
            {children}
          </main>

          <footer class="border-t border-base-300 bg-base-100">
            <div class="mx-auto max-w-6xl px-4 py-3 text-xs text-base-content/60">
              Self-hosted invoice generator
            </div>
          </footer>
        </div>
      </body>
      </html>
    </>
  );
}

function navLinkClass(href: string, currentPath?: string): string {
  const base = "rounded-md px-3 py-1.5 text-sm font-medium transition-colors";
  return isActive(href, currentPath)
    ? `${base} bg-primary/10 text-primary`
    : `${base} text-base-content/70 hover:bg-base-200`;
}

function isActive(href: string, currentPath?: string): boolean {
  if (!currentPath) return false;
  if (href === "/") return currentPath === "/";
  return currentPath === href || currentPath.startsWith(`${href}/`);
}
