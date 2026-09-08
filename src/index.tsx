import { env } from "./config/env.ts";
import { parseListenOptions } from "./config/listen-options.ts";

let listenOptions: ReturnType<typeof parseListenOptions>;
try {
  listenOptions = parseListenOptions(process.argv.slice(2), env.hostname);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
if (listenOptions.help) {
  console.log("Usage: invoice [--host <IP|localhost>]\n\nDefault host: 127.0.0.1 (or INVOICE_HOST). --host takes precedence.\nUse --host 0.0.0.0 to allow network connections. There is no built-in authentication.\nSet PORT to change the port (default: 3000).");
  process.exit(0);
}

async function start() {
  // Validate flags before importing modules that open the database or write files.
  const [{ createApp }, { ensureDataDirs }, { runMigrations }, { extractEmbeddedRuntimeFiles }] = await Promise.all([
    import("./app.tsx"),
    import("./config/paths.ts"),
    import("./db/migrate.ts"),
    import("./runtime/embedded-runtime.ts"),
  ]);

  ensureDataDirs();
  extractEmbeddedRuntimeFiles();
  runMigrations();

  const app = createApp();

  Bun.serve({
    port: env.port,
    hostname: listenOptions.hostname,
    fetch: app.fetch,
  });
  const displayHost = listenOptions.hostname.includes(":") ? `[${listenOptions.hostname}]` : listenOptions.hostname;
  console.log(`▶ Pipa listening on http://${displayHost}:${env.port}`);
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
