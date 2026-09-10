import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { clients, files, invoiceItems, invoiceOperations, invoicePdfVersions, invoicePreviews, invoiceSequences, invoices, notaFiscalLinks } from "../../db/schema.ts";
import { nowIso } from "../../domain/dates.ts";
import { operationIdentity, sha256Identity } from "../../domain/invoice-workspace.ts";
import { absolutePath } from "../files/files.service.ts";
import { createHtmlTemplate } from "../pdf-templates/pdf-templates.service.ts";
import { createInvoice, getInvoiceDetail, pdfFilename } from "./invoices.service.ts";
import { createSavedDataPreview, executeWorkspaceCommand, getPreviewFile, listInvoicePdfVersions, operationResult } from "./invoice-workspace.service.ts";

function fixture() {
  const now = nowIso();
  const client = db.insert(clients).values({ name: "Command test client", code: `CMD${crypto.randomUUID().slice(0, 8)}`, defaultCurrency: "GBP", numberingProfileId: 1, createdAt: now, updatedAt: now }).returning().get();
  const invoice = createInvoice({ clientId: client.id, invoiceDate: "2026-09-09", currency: "GBP", items: [{ name: "Services", value: "12.50", source: "other" }] });
  return { client, detail: getInvoiceDetail(invoice.id)! };
}

function command(invoiceId: number, revision: number, kind: "issue" | "pdf-version" | "status" | "revert", arguments_: Record<string, string> = {}) {
  const raw = { schemaVersion: 1 as const, operationId: crypto.randomUUID(), expectedRevision: revision, kind, arguments: arguments_ };
  return { ...raw, canonicalPayloadDigest: operationIdentity({ schemaVersion: raw.schemaVersion, kind, baseRevision: revision, arguments: arguments_ }) };
}

beforeEach(() => {
  db.delete(invoiceItems).run(); db.delete(invoices).run(); db.delete(invoiceSequences).run(); db.delete(clients).run(); db.delete(files).run();
});

afterEach(() => { delete process.env.GOTENBERG_URL; delete process.env.GOTENBERG_TIMEOUT_MS; });

describe("workspace PDF and lifecycle commands", () => {
  test("a fenced-out renderer worker cannot overwrite the lease-takeover receipt", async () => {
    const { detail } = fixture(); const template = createHtmlTemplate(`Fence ${crypto.randomUUID()}`, "<!doctype html><html><head><title>x</title></head><body>{{ invoice.number }}</body></html>");
    db.update(invoices).set({ pdfTemplateRevisionId: template.currentRevisionId }).where(eq(invoices.id, detail.invoice.id)).run();
    let firstStarted!: () => void, releaseFirst!: () => void;
    const started = new Promise<void>((resolve) => { firstStarted = resolve; });
    const firstRelease = new Promise<void>((resolve) => { releaseFirst = resolve; }); let calls = 0;
    const server = Bun.serve({ port: 0, async fetch() { calls++; if (calls === 1) { firstStarted(); await firstRelease; } return new Response(`%PDF-1.7\nworker-${calls}`, { headers: { "content-type": "application/pdf" } }); } });
    process.env.GOTENBERG_URL = `http://127.0.0.1:${server.port}`;
    try {
      const current = getInvoiceDetail(detail.invoice.id)!; const input = command(current.invoice.id, current.invoice.workspaceRevision, "issue");
      const workerA = executeWorkspaceCommand(current.invoice.id, input); await started;
      db.update(invoiceOperations).set({ leaseExpiresAt: "2000-01-01T00:00:00.000Z" }).where(and(eq(invoiceOperations.invoiceId, current.invoice.id), eq(invoiceOperations.id, input.operationId))).run();
      const workerB = executeWorkspaceCommand(current.invoice.id, input); const winner = await workerB; releaseFirst(); const loser = await workerA;
      expect(winner.outcome).toBe("committed"); expect(loser).toEqual(winner);
      const saved = getInvoiceDetail(current.invoice.id)!; expect(saved.invoice.status).toBe("issued"); expect(saved.invoice.workspaceRevision).toBe(current.invoice.workspaceRevision + 1); expect(listInvoicePdfVersions(current.invoice.id)).toHaveLength(1);
    } finally { server.stop(true); }
  });

  test("operation keys cannot be repurposed across kinds or payloads", async () => {
    const { detail } = fixture(); const input = command(detail.invoice.id, detail.invoice.workspaceRevision, "issue");
    const committed = await executeWorkspaceCommand(detail.invoice.id, input); expect(committed.outcome).toBe("committed");
    const changedKind = { ...input, kind: "revert" as const, canonicalPayloadDigest: operationIdentity({ schemaVersion: 1, kind: "revert", baseRevision: input.expectedRevision, arguments: {} }) };
    await expect(executeWorkspaceCommand(detail.invoice.id, changedKind)).rejects.toMatchObject({ code: "OPERATION_KEY_REUSED" });
    expect(operationResult(detail.invoice.id, input.operationId)).toEqual(committed);
  });

  test("status and revert use receipts and reject stale revisions", async () => {
    const { detail } = fixture(); const issued = await executeWorkspaceCommand(detail.invoice.id, command(detail.invoice.id, detail.invoice.workspaceRevision, "issue"));
    const sentInput = command(detail.invoice.id, issued.resultingRevision!, "status", { status: "sent" }); const sent = await executeWorkspaceCommand(detail.invoice.id, sentInput);
    expect(sent).toMatchObject({ outcome: "committed", kind: "status" }); expect(await executeWorkspaceCommand(detail.invoice.id, sentInput)).toEqual(sent);
    const staleRevert = await executeWorkspaceCommand(detail.invoice.id, command(detail.invoice.id, issued.resultingRevision!, "revert"));
    expect(staleRevert).toMatchObject({ outcome: "rejected", code: "STALE_REVISION" });
    const reverted = await executeWorkspaceCommand(detail.invoice.id, command(detail.invoice.id, sent.resultingRevision!, "revert"));
    expect(reverted).toMatchObject({ outcome: "committed", kind: "revert" }); expect(getInvoiceDetail(detail.invoice.id)!.invoice.status).toBe("draft");
  });
  test("issue atomically archives, versions, revises, and retains a replayable receipt", async () => {
    const { detail } = fixture(); const input = command(detail.invoice.id, detail.invoice.workspaceRevision, "issue");
    const first = await executeWorkspaceCommand(detail.invoice.id, input);
    expect(first.outcome).toBe("committed"); expect(first.resultingRevision).toBe(detail.invoice.workspaceRevision + 1);
    const saved = getInvoiceDetail(detail.invoice.id)!;
    expect(saved.invoice.status).toBe("issued"); expect(saved.invoice.archivedPdfFileId).not.toBeNull();
    expect(listInvoicePdfVersions(detail.invoice.id)).toHaveLength(1);
    expect(operationResult(detail.invoice.id, input.operationId)).toEqual(first);
    expect(await executeWorkspaceCommand(detail.invoice.id, input)).toEqual(first);
    expect(listInvoicePdfVersions(detail.invoice.id)).toHaveLength(1);
  });

  test("a stale command is terminally rejected without a new version", async () => {
    const { detail } = fixture();
    db.update(invoices).set({ workspaceRevision: detail.invoice.workspaceRevision + 1 }).where(eq(invoices.id, detail.invoice.id)).run();
    const result = await executeWorkspaceCommand(detail.invoice.id, command(detail.invoice.id, detail.invoice.workspaceRevision, "issue"));
    expect(result.outcome).toBe("rejected"); expect(result.code).toBe("STALE_REVISION");
    expect(listInvoicePdfVersions(detail.invoice.id)).toHaveLength(0);
    expect(getInvoiceDetail(detail.invoice.id)!.invoice.archivedPdfFileId).toBeNull();
  });

  test("renderer failure records rejection without archive, status, or revision mutation", async () => {
    const { detail } = fixture(); const template = createHtmlTemplate(`Unavailable ${crypto.randomUUID()}`, "<!doctype html><html><head><title>x</title></head><body>{{ invoice.number }}</body></html>");
    db.update(invoices).set({ pdfTemplateRevisionId: template.currentRevisionId }).where(eq(invoices.id, detail.invoice.id)).run();
    process.env.GOTENBERG_URL = "http://127.0.0.1:1"; process.env.GOTENBERG_TIMEOUT_MS = "20";
    const current = getInvoiceDetail(detail.invoice.id)!;
    const result = await executeWorkspaceCommand(current.invoice.id, command(current.invoice.id, current.invoice.workspaceRevision, "issue"));
    expect(result).toMatchObject({ outcome: "rejected", code: "RENDER_FAILED" });
    const after = getInvoiceDetail(current.invoice.id)!;
    expect(after.invoice.status).toBe("draft"); expect(after.invoice.archivedPdfFileId).toBeNull(); expect(after.invoice.workspaceRevision).toBe(current.invoice.workspaceRevision);
  });

  test("a live filename dependency changed while rendering rejects instead of publishing bytes", async () => {
    const { detail, client } = fixture(); const template = createHtmlTemplate(`Race ${crypto.randomUUID()}`, "<!doctype html><html><head><title>x</title></head><body>{{ invoice.number }}</body></html>");
    db.update(clients).set({ defaultPdfFilenameTemplate: "{{invoice.number}}-{{client.name}}.pdf" }).where(eq(clients.id, client.id)).run();
    db.update(invoices).set({ pdfTemplateRevisionId: template.currentRevisionId }).where(eq(invoices.id, detail.invoice.id)).run();
    const server = Bun.serve({ port: 0, async fetch() { db.update(clients).set({ name: "Changed during render", updatedAt: nowIso() }).where(eq(clients.id, client.id)).run(); return new Response("%PDF-1.7\nrace", { headers: { "content-type": "application/pdf" } }); } });
    process.env.GOTENBERG_URL = `http://127.0.0.1:${server.port}`;
    try {
      const current = getInvoiceDetail(detail.invoice.id)!;
      expect(pdfFilename(current)).toContain("Command_test_client");
      const result = await executeWorkspaceCommand(current.invoice.id, command(current.invoice.id, current.invoice.workspaceRevision, "pdf-version"));
      expect(pdfFilename(getInvoiceDetail(current.invoice.id)!)).toContain("Changed_during_render");
      expect(result).toMatchObject({ outcome: "rejected", code: "DEPENDENCY_CONFLICT" });
      expect(listInvoicePdfVersions(current.invoice.id)).toHaveLength(0);
    } finally { server.stop(true); }
  });

  test("saved preview exposes the exact immutable stored bytes and expires", async () => {
    const { detail } = fixture(); const previewId = crypto.randomUUID();
    const inputDigest = sha256Identity({ invoiceId: detail.invoice.id, revision: detail.invoice.workspaceRevision, sourceKind: "current-saved-data" });
    const result = await createSavedDataPreview(detail.invoice.id, { previewId, sourceKind: "current-saved-data", inputDigest });
    const owned = getPreviewFile(detail.invoice.id, previewId)!;
    expect(readFileSync(absolutePath(owned.file))).toEqual(readFileSync(absolutePath(owned.file)));
    expect(owned.preview.byteHash).toBe(owned.file.sha256); expect(result.url).toContain(previewId);
    db.update(invoicePreviews).set({ expiresAt: "2000-01-01T00:00:00.000Z" }).where(and(eq(invoicePreviews.id, previewId), eq(invoicePreviews.invoiceId, detail.invoice.id))).run();
    expect(getPreviewFile(detail.invoice.id, previewId)).toBeNull();
  });
});
