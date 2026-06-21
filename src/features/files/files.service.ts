import { createHash, randomBytes } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { paths } from "../../config/paths.ts";
import { sanitizeFilename } from "../../domain/filename-template.ts";
import type { FileRecord } from "../../db/schema.ts";
import { insertFile, markSuperseded } from "./files.repository.ts";

export type StoreFileInput = {
  /** archived_invoice | nfse_pdf | nfse_xml | ... */
  kind: string;
  bytes: Uint8Array | Buffer;
  /** Absolute target directory; must resolve under FILES_DIR. */
  destDir: string;
  /** Desired basename; sanitized to a single safe path segment. */
  desiredBasename: string;
  /** Uploaded name kept as metadata only — never used to build a path. */
  originalFilename?: string | null;
  mimeType?: string | null;
};

/**
 * Append-only file write (spec §21, architecture plan §"File Storage"):
 *   write temp file -> sha256 -> pick a non-colliding final path -> atomic
 *   move -> insert metadata row.
 *
 * Never overwrites an existing file: if the desired path is taken, a numbered
 * variant is chosen so prior bytes survive (callers supersede the old metadata
 * row separately). The final path is verified to stay within FILES_DIR.
 */
export function storeFile(input: StoreFileInput): FileRecord {
  const buffer = Buffer.from(input.bytes);
  const sha256 = createHash("sha256").update(buffer).digest("hex");

  const destDir = resolve(input.destDir);
  assertWithinFilesDir(destDir);
  mkdirSync(destDir, { recursive: true });

  const safeBase = safeBasename(input.desiredBasename);
  const finalPath = uniquePath(destDir, safeBase);
  assertWithinFilesDir(finalPath);

  mkdirSync(paths.tmpDir, { recursive: true });
  const tmpPath = join(paths.tmpDir, `${randomBytes(12).toString("hex")}.tmp`);
  writeFileSync(tmpPath, buffer);
  moveAtomic(tmpPath, finalPath);

  return insertFile({
    kind: input.kind,
    originalFilename: input.originalFilename ?? null,
    storedPath: relative(paths.filesDir, finalPath),
    mimeType: input.mimeType ?? null,
    sizeBytes: buffer.length,
    sha256,
    deletedAt: null,
    supersededByFileId: null,
  });
}

/** Absolute path to a stored file from its metadata row. */
export function absolutePath(file: FileRecord): string {
  return join(paths.filesDir, file.storedPath);
}

/**
 * Record a replacement for an existing file: store the new bytes and point the
 * old row's `supersededByFileId` at it. Returns the new metadata row.
 */
export function supersedeFile(
  oldFileId: number | null | undefined,
  input: StoreFileInput,
): FileRecord {
  const next = storeFile(input);
  if (oldFileId != null) markSuperseded(oldFileId, next.id);
  return next;
}

/** Reduce a name to one safe path segment, preserving its extension. */
function safeBasename(name: string): string {
  const ext = extname(name);
  const safeExt = sanitizeFilename(ext);
  const stem = sanitizeFilename(name.slice(0, name.length - ext.length)) || "file";
  return safeExt ? `${stem}.${safeExt.replace(/^\./, "")}` : stem;
}

/** First free path of `<base>`, `<base>-2`, `<base>-3`, … in `dir`. */
function uniquePath(dir: string, basename: string): string {
  const ext = extname(basename);
  const stem = basename.slice(0, basename.length - ext.length);
  let candidate = join(dir, basename);
  let n = 2;
  while (existsSync(candidate)) {
    candidate = join(dir, `${stem}-${n}${ext}`);
    n += 1;
  }
  return candidate;
}

/** Rename within FILES_DIR; fall back to copy+unlink across filesystems. */
function moveAtomic(from: string, to: string): void {
  try {
    renameSync(from, to);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EXDEV") {
      copyFileSync(from, to);
      unlinkSync(from);
    } else {
      throw err;
    }
  }
}

function assertWithinFilesDir(target: string): void {
  const root = resolve(paths.filesDir);
  const rel = relative(root, target);
  if (rel === "" || rel.startsWith("..") || resolve(root, rel) !== target) {
    throw new Error(`Refusing to write outside FILES_DIR: ${target}`);
  }
}
