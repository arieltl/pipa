/**
 * Copies vendored client libraries (htmx, Alpine) from node_modules into
 * src/public so the app never depends on a CDN at runtime. Run via
 * `bun run build:vendor`.
 */
import { mkdir, copyFile, cp } from "node:fs/promises";
import { dirname, join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const PUBLIC_DIR = join(ROOT, "src", "public");

const ASSETS: Array<{ from: string; to: string }> = [
  { from: "node_modules/htmx.org/dist/htmx.min.js", to: "htmx.min.js" },
  { from: "node_modules/alpinejs/dist/cdn.min.js", to: "alpine.min.js" },
  { from: "assets/app.js", to: "app.js" },
  { from: "assets/pdf-preview.mjs", to: "pdf-preview.mjs" },
  { from: "node_modules/pdfjs-dist/build/pdf.min.mjs", to: "pdfjs/pdf.mjs" },
  { from: "node_modules/pdfjs-dist/build/pdf.worker.min.mjs", to: "pdfjs/pdf.worker.mjs" },
  { from: "node_modules/pdfjs-dist/web/pdf_viewer.mjs", to: "pdfjs/pdf_viewer.mjs" },
  { from: "node_modules/pdfjs-dist/web/pdf_viewer.css", to: "pdfjs/pdf_viewer.css" },
  { from: "node_modules/pdfjs-dist/LICENSE", to: "pdfjs/LICENSE" },
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

for (const directory of ["cmaps", "standard_fonts", "wasm", "iccs", "web/images"]) {
  await cp(join(ROOT, "node_modules/pdfjs-dist", directory), join(PUBLIC_DIR, "pdfjs", directory === "web/images" ? "images" : directory), { recursive: true });
}
