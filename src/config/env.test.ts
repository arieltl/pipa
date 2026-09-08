import { expect, test } from "bun:test";

test("DATA_DIR supplies storage defaults when the individual paths are unset", () => {
  const result = Bun.spawnSync({
    cmd: [
      process.execPath,
      "--eval",
      'import { env } from "./src/config/env.ts"; console.log(JSON.stringify(env));',
    ],
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATA_DIR: "/var/lib/invoice",
      DB_PATH: "",
      FILES_DIR: "",
      TMP_DIR: "",
      INVOICE_HOST: "",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  expect(result.exitCode).toBe(0);
  const env = JSON.parse(result.stdout.toString());
  expect(env).toMatchObject({
    dataDir: "/var/lib/invoice",
    dbPath: "/var/lib/invoice/app.db",
    filesDir: "/var/lib/invoice/files",
    tmpDir: "/var/lib/invoice/tmp",
    hostname: "127.0.0.1",
  });
});
