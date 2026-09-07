import { Hono } from "hono";
import { logger } from "hono/logger";
import { bodyLimit } from "hono/body-limit";
import { serveStatic } from "hono/bun";
import { renderer } from "./web/renderer.tsx";
import { Placeholder } from "./web/components/placeholder.tsx";
import { dashboardRoutes } from "./features/dashboard/dashboard.routes.tsx";
import { clientsRoutes } from "./features/clients/clients.routes.tsx";
import { invoicesRoutes } from "./features/invoices/invoices.routes.tsx";
import { numberingRoutes } from "./features/numbering/numbering.routes.tsx";
import { settingsRoutes } from "./features/settings/settings.routes.tsx";
import { paths } from "./config/paths.ts";
import { existsSync } from "node:fs";
import { pdfTemplatesRoutes } from "./features/pdf-templates/pdf-templates.routes.tsx";

function staticRoot(): string {
  return existsSync(paths.runtimeStaticRoot) ? paths.runtimeStaticRoot : "./src";
}

export function createApp() {
  const app = new Hono();

  app.use("*", logger());
  // Browser requests from other sites must not mutate a trusted-network instance.
  // Headerless CLI clients remain supported; authentication belongs at the proxy.
  app.use("*", async (c, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
      const site = c.req.header("Sec-Fetch-Site");
      const origin = c.req.header("Origin");
      if (site === "cross-site" || site === "same-site" ||
          (origin && site !== "same-origin" && origin !== new URL(c.req.url).origin)) {
        return c.html('<div role="alert" class="alert alert-error">Cross-origin changes are not allowed. Open this app directly and try again.</div>', 403);
      }
    }
    await next();
  });
  app.use("*", bodyLimit({
    maxSize: 20 * 1024 * 1024,
    onError: (c) => c.html('<div role="alert" class="alert alert-error">Request too large. Submit less than 20 MiB at a time.</div>', 413),
  }));

  // Vendored assets and built CSS live under src/public. Request path
  // `/public/foo` maps to `./src/public/foo`.
  app.use(
    "/public/*",
    serveStatic({
      root: staticRoot(),
      onFound: (_path, c) => {
        c.header("Cache-Control", "no-cache");
      },
    }),
  );

  // Lightweight liveness check for Docker / reverse proxies.
  app.get("/healthz", (c) => c.json({ status: "ok" }));

  // htmx-aware rendering for all page routes below.
  app.use("*", renderer);

  app.route("/", dashboardRoutes);
  app.route("/clients", clientsRoutes);
  app.route("/invoices", invoicesRoutes);
  app.route("/settings/numbering", numberingRoutes);
  app.route("/settings/pdf-templates", pdfTemplatesRoutes);
  app.route("/settings", settingsRoutes);

  app.notFound((c) => {
    c.status(404);
    return c.render(
      <Placeholder title="Not found" phase="another part of the app" />,
      { title: "Not found" },
    );
  });

  return app;
}
