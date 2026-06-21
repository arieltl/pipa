import { Hono } from "hono";
import { logger } from "hono/logger";
import { serveStatic } from "hono/bun";
import { renderer } from "./web/renderer.tsx";
import { Placeholder } from "./web/components/placeholder.tsx";
import { dashboardRoutes } from "./features/dashboard/dashboard.routes.tsx";
import { clientsRoutes } from "./features/clients/clients.routes.tsx";
import { settingsRoutes } from "./features/settings/settings.routes.tsx";

export function createApp() {
  const app = new Hono();

  app.use("*", logger());

  // Vendored assets and built CSS live under src/public. Request path
  // `/public/foo` maps to `./src/public/foo`.
  app.use(
    "/public/*",
    serveStatic({
      root: "./src",
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
  app.route("/settings", settingsRoutes);

  // Placeholder sections — replaced as later build phases land.
  app.get("/invoices", (c) =>
    c.render(<Placeholder title="Invoices" phase="Phase 3 (invoice core)" />, {
      title: "Invoices",
    }),
  );
  app.get("/invoices/new", (c) =>
    c.render(
      <Placeholder title="New invoice" phase="Phase 3 (invoice core)" />,
      { title: "New invoice" },
    ),
  );

  app.notFound((c) => {
    c.status(404);
    return c.render(
      <Placeholder title="Not found" phase="another part of the app" />,
      { title: "Not found" },
    );
  });

  return app;
}
