import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { embeddedRuntimeFiles } from "./embedded-files.generated.ts";
import { paths } from "../config/paths.ts";

let extracted = false;

/**
 * Extract files embedded in the compiled executable into a regular directory.
 * This keeps filesystem-based libraries working in production binaries.
 */
export function extractEmbeddedRuntimeFiles(): void {
  if (extracted) return;

  for (const file of embeddedRuntimeFiles) {
    const destination = join(paths.runtimeDir, file.target);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, readFileSync(file.source));
  }

  extracted = true;
}
