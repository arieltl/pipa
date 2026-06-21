import type { Context, MiddlewareHandler } from "hono";
import type { Child } from "hono/jsx";
import { Layout } from "./layout.tsx";

/**
 * htmx-aware renderer.
 *
 * Full document requests get wrapped in the shared {@link Layout}. htmx
 * requests (identified by the `HX-Request` header) receive only the rendered
 * fragment, so route handlers can return the same JSX for both cases.
 *
 * Usage in a handler:
 *   c.render(<DashboardPage />, { title: "Dashboard" })
 */
declare module "hono" {
  interface ContextRenderer {
    (content: Child, options?: RenderOptions): Response | Promise<Response>;
  }
}

export type RenderOptions = {
  title?: string;
};

export function isHtmxRequest(c: Context): boolean {
  return c.req.header("HX-Request") === "true";
}

export const renderer: MiddlewareHandler = async (c, next) => {
  c.setRenderer((content, options) => {
    if (isHtmxRequest(c)) {
      // Fragment responses skip the layout. The runtime value is an
      // HtmlEscapedString; cast to satisfy c.html's string-typed overloads.
      return c.html(content as Parameters<typeof c.html>[0]);
    }
    return c.html(
      <Layout title={options?.title} currentPath={c.req.path}>
        {content}
      </Layout>,
    );
  });
  await next();
};
