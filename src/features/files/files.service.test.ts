import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { paths } from "../../config/paths.ts";
import { absolutePath, storeFile, supersedeFile } from "./files.service.ts";
import { getFileById } from "./files.repository.ts";

const destDir = join(paths.archivedInvoicesDir, "2026");

function bytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

describe("storeFile", () => {
  test("writes the file, hashes it, and records metadata", () => {
    const data = bytes("hello pdf");
    const rec = storeFile({
      kind: "archived_invoice",
      bytes: data,
      destDir,
      desiredBasename: "INV-1.pdf",
      mimeType: "application/pdf",
    });

    expect(rec.kind).toBe("archived_invoice");
    expect(rec.sizeBytes).toBe(data.length);
    expect(rec.sha256).toBe(createHash("sha256").update(data).digest("hex"));
    expect(existsSync(absolutePath(rec))).toBe(true);
    expect(readFileSync(absolutePath(rec))).toEqual(Buffer.from(data));
    // Stored path is relative to FILES_DIR and stays inside it.
    expect(rec.storedPath.startsWith("..")).toBe(false);
  });

  test("never overwrites an existing file — collisions get a numbered variant", () => {
    const a = storeFile({
      kind: "archived_invoice",
      bytes: bytes("first"),
      destDir,
      desiredBasename: "DUP.pdf",
    });
    const b = storeFile({
      kind: "archived_invoice",
      bytes: bytes("second"),
      destDir,
      desiredBasename: "DUP.pdf",
    });

    expect(a.storedPath).not.toBe(b.storedPath);
    // Original bytes are preserved, not clobbered.
    expect(readFileSync(absolutePath(a)).toString()).toBe("first");
    expect(readFileSync(absolutePath(b)).toString()).toBe("second");
  });

  test("rejects a destination outside FILES_DIR", () => {
    expect(() =>
      storeFile({
        kind: "archived_invoice",
        bytes: bytes("x"),
        destDir: join(paths.filesDir, "..", "escape"),
        desiredBasename: "x.pdf",
      }),
    ).toThrow(/outside FILES_DIR/);
  });

  test("sanitizes a traversal attempt in the basename to a safe segment", () => {
    const rec = storeFile({
      kind: "nfse_xml",
      bytes: bytes("<xml/>"),
      destDir,
      desiredBasename: "../../etc/passwd",
      originalFilename: "../../etc/passwd",
    });
    // Resolved file is still inside the intended directory.
    expect(absolutePath(rec).startsWith(destDir)).toBe(true);
    expect(rec.storedPath).not.toContain("..");
    // The original (untrusted) name is kept only as metadata.
    expect(rec.originalFilename).toBe("../../etc/passwd");
  });
});

describe("supersedeFile", () => {
  test("stores the new file and links the old row to it", () => {
    const old = storeFile({
      kind: "archived_invoice",
      bytes: bytes("v1"),
      destDir,
      desiredBasename: "SUP.pdf",
    });
    const next = supersedeFile(old.id, {
      kind: "archived_invoice",
      bytes: bytes("v2"),
      destDir,
      desiredBasename: "SUP.pdf",
    });

    expect(next.id).not.toBe(old.id);
    expect(getFileById(old.id)!.supersededByFileId).toBe(next.id);
    // Both files survive on disk (append-only).
    expect(existsSync(absolutePath(old))).toBe(true);
    expect(existsSync(absolutePath(next))).toBe(true);
  });

  test("with no prior file just stores the new one", () => {
    const rec = supersedeFile(null, {
      kind: "archived_invoice",
      bytes: bytes("only"),
      destDir,
      desiredBasename: "NEW.pdf",
    });
    expect(rec.supersededByFileId).toBeNull();
  });
});
