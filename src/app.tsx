import { Hono } from "hono";
import { logger } from "hono/logger";
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

function staticRoot(): string {
  return existsSync(paths.runtimeStaticRoot) ? paths.runtimeStaticRoot : "./src";
}

export function createApp() {
  const app = new Hono();

  app.use("*", logger());

  // Vendored assets and built CSS live under src/public. Request path
  // `/public/foo` maps to `./src/public/foo`.
  app.use(
    "/public/*",
    serveStatic({
      root: staticRoot(),
      onFound: (_path, c) => {
        c.header("Cache-Control", "public, max-age=3600");
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
