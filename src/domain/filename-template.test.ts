import { describe, expect, test } from "bun:test";
import { renderFilename, sanitizeFilename } from "./filename-template.ts";

describe("sanitizeFilename", () => {
  test("keeps safe characters", () => {
    expect(sanitizeFilename("LONDONCO-202606-01_2026-06-30")).toBe(
      "LONDONCO-202606-01_2026-06-30",
    );
  });

  test("turns spaces into underscores", () => {
    expect(sanitizeFilename("My Invoice 01")).toBe("My_Invoice_01");
  });

  test("strips path separators (no traversal)", () => {
    const out = sanitizeFilename("../../etc/passwd");
    expect(out).not.toContain("/");
    expect(out).not.toContain("..");
    expect(out).toBe("etc-passwd");
  });

  test("collapses dot runs and trims leading separators", () => {
    expect(sanitizeFilename("...secret..pdf")).toBe("secret.pdf");
    expect(sanitizeFilename("..")).toBe("");
  });

  test("drops illegal characters", () => {
    expect(sanitizeFilename('a<>:"|?*b')).toBe("ab");
  });
});

describe("renderFilename", () => {
  const ctx = {
    "invoice.number": "LONDONCO-202606-01",
    "client.code": "LONDONCO",
    "invoice.date": "30/06/2026",
  };

  test("renders and sanitizes a template into a .pdf basename", () => {
    expect(
      renderFilename(
        "{{invoice.number}}_{{client.code}}_{{invoice.date}}.pdf",
        ctx,
        "fallback",
      ),
    ).toBe("LONDONCO-202606-01_LONDONCO_30-06-2026.pdf");
  });

  test("adds a .pdf extension when the template omits one", () => {
    expect(renderFilename("{{invoice.number}}", ctx, "fallback")).toBe(
      "LONDONCO-202606-01.pdf",
    );
  });

  test("uses the fallback for empty templates", () => {
    expect(renderFilename("", ctx, "invoice-7")).toBe("invoice-7.pdf");
    expect(renderFilename(null, ctx, "invoice-7")).toBe("invoice-7.pdf");
  });

  test("falls back when unresolved variables leave nothing safe", () => {
    expect(renderFilename("{{bogus}}", ctx, "invoice-7")).toBe("invoice-7.pdf");
  });

  test("a malicious template cannot escape the basename", () => {
    const out = renderFilename("{{client.code}}", { "client.code": "../../x" }, "f");
    expect(out).not.toContain("/");
    expect(out).not.toContain("..");
  });
});
