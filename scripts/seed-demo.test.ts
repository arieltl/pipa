import { Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import { mkdirSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";

const workspace = join(import.meta.dir, "..");
const created: string[] = [];

function fixture(name: string): string {
  const path = join(workspace, "data", `seed-demo-test-${name}-${crypto.randomUUID()}`);
  mkdirSync(path, { recursive: true });
  created.push(path);
  return path;
}

function runSeed(dir: string) {
  return Bun.spawnSync([process.execPath, "run", "scripts/seed-demo.ts"], {
    cwd: workspace,
    env: { ...process.env, DEMO_DATA_DIR: dir, DB_PATH: "/definitely-not-the-demo-db/app.db" },
    stdout: "pipe",
    stderr: "pipe",
  });
}

afterEach(() => {
  for (const path of created.splice(0)) rmSync(path, { recursive: true, force: true });
});

test("refuses any existing unmarked database, even when inherited DB_PATH differs", () => {
  const dir = fixture("existing-db");
  new Database(join(dir, "app.db")).close();
  const result = runSeed(dir);
  expect(result.exitCode).not.toBe(0);
  expect(new TextDecoder().decode(result.stderr)).toContain("Refusing existing unmarked demo database");
});

test("refuses a symlinked demo directory", () => {
  const target = fixture("target");
  const link = join(workspace, "data", `seed-demo-test-link-${crypto.randomUUID()}`);
  symlinkSync(target, link);
  created.push(link);
  const result = runSeed(link);
  expect(result.exitCode).not.toBe(0);
  expect(new TextDecoder().decode(result.stderr)).toContain("Refusing symlinked demo storage path");
});
