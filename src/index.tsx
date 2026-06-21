import { createApp } from "./app.tsx";
import { env } from "./config/env.ts";
import { ensureDataDirs } from "./config/paths.ts";
import { runMigrations } from "./db/migrate.ts";
import { extractEmbeddedRuntimeFiles } from "./runtime/embedded-runtime.ts";

ensureDataDirs();
extractEmbeddedRuntimeFiles();
runMigrations();

const app = createApp();

console.log(`▶ invoice app listening on http://localhost:${env.port}`);

export default {
  port: env.port,
  fetch: app.fetch,
};
