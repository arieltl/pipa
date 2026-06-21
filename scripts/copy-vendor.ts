/**
 * Copies vendored client libraries (htmx, Alpine) from node_modules into
 * src/public so the app never depends on a CDN at runtime. Run via
 * `bun run build:vendor`.
 */
import { mkdir, copyFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const PUBLIC_DIR = join(ROOT, "src", "public");

const ASSETS: Array<{ from: string; to: string }> = [
  { from: "node_modules/htmx.org/dist/htmx.min.js", to: "htmx.min.js" },
  { from: "node_modules/alpinejs/dist/cdn.min.js", to: "alpine.min.js" },
  { from: "assets/app.js", to: "app.js" },
];

await mkdir(PUBLIC_DIR, { recursive: true });

for (const asset of ASSETS) {
  const src = join(ROOT, asset.from);
  const dest = join(PUBLIC_DIR, asset.to);
  await mkdir(dirname(dest), { recursive: true });
  await copyFile(src, dest);
  console.log(`✓ ${asset.to}`);
}

console.log("vendored client assets copied to src/public");
