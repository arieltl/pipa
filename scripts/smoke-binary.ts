/** Exercise the shipped executable without source files or an existing database. */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const argument = process.argv[2];
if (!argument) throw new Error("Usage: bun run scripts/smoke-binary.ts <executable>");
const executable = resolve(argument);
const directory = await mkdtemp(join(tmpdir(), "pipa-binary-smoke-"));
const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
const port = reservation.port!;
await reservation.stop(true);
const base = `http://127.0.0.1:${port}`;
const environment = {
  ...process.env,
  NODE_ENV: "production",
  INVOICE_HOST: "127.0.0.1",
  PORT: String(port),
  DATA_DIR: directory,
  DB_PATH: join(directory, "app.db"),
  FILES_DIR: join(directory, "files"),
  TMP_DIR: join(directory, "tmp"),
  GOTENBERG_URL: "",
};
let child: ReturnType<typeof Bun.spawn> | undefined;
async function start() {
  child = Bun.spawn([executable], {
    cwd: directory, env: environment, stdout: "inherit", stderr: "inherit",
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(`Executable exited: ${child.exitCode}`);
    try {
      if ((await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(1000) })).ok) return;
    } catch { /* Startup may still be applying migrations. */ }
    await Bun.sleep(200);
  }
  throw new Error("Executable did not become healthy within 20 seconds");
}
async function stop() {
  if (!child) return;
  child.kill();
  await child.exited;
  child = undefined;
}
async function get(path: string) {
  const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(30000) });
  assert.equal(response.status, 200, path);
  return response;
}
try {
  const help = Bun.spawn([executable, "--help"], {
    cwd: directory, env: environment, stdout: "pipe", stderr: "inherit",
  });
  assert.match(await new Response(help.stdout).text(), /--host/);
  assert.equal(await help.exited, 0);
  await start();
  assert.match(await (await get("/")).text(), /Pipa/);
  assert.match(await (await get("/public/pipa-logo.svg")).text(), /<svg/);
  assert.ok((await (await get("/public/app.css")).text()).length > 1000);
  const created = await fetch(`${base}/clients`, {
    method: "POST",
    body: new URLSearchParams({ name: "Binary Smoke Client", code: "SMOKE", defaultCurrency: "USD" }),
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(created.status, 201, await created.text());
  const pdf = await get("/settings/pdf-templates/1/sample.pdf");
  assert.match(pdf.headers.get("content-type") ?? "", /application\/pdf/);
  assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString(), "%PDF-");
  await stop();
  await start();
  assert.match(await (await get("/clients")).text(), /Binary Smoke Client/);
  console.log("Binary smoke passed: CLI, startup, embedded assets, SQLite persistence, PDF, restart");
} finally {
  await stop();
  // Only this script's freshly created, isolated temporary directory is removed.
  await rm(directory, { recursive: true, force: true });
}
