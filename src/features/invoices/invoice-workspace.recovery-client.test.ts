import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Window, type HTMLElement as HappyHTMLElement } from "happy-dom";

const appSource = readFileSync(new URL("../../../assets/app.js", import.meta.url), "utf8");

type Coordinator = Record<string, any>;

function coordinator(options: { storage?: Storage; location?: Location; confirm?: () => boolean } = {}) {
  const window = new Window({ url: "http://pipa.test/invoices/44/edit" });
  const document = window.document;
  document.body.innerHTML = `<main data-invoice-editor>
    <div id="edit-command-result"></div><div id="edit-error-summary" tabindex="-1"></div>
    <div id="edit-conflict-summary"></div>
    <input data-field-path="invoice.notes"><p data-field-error="invoice.notes"></p>
  </main>`;
  let factory: ((encoded: string) => Coordinator) | undefined;
  (window as any).Alpine = { data(name: string, candidate: (encoded: string) => Coordinator) { if (name === "invoiceEditSession") factory = candidate; } };
  (window as any).htmx = { ajax: async () => undefined };
  (window as any).CSS ??= { escape: (value: string) => value.replaceAll(".", "\\.") };
  // `Window` deliberately disables eval. Execute the real browser asset with
  // the happy-dom objects as its lexical browser globals instead.
  new Function(
    "window", "document", "sessionStorage", "location", "history", "crypto", "CSS", "DOMParser", "FormData", "Blob", "URL",
    "HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement", "Element", "confirm", "fetch", appSource,
  )(
    window, document, options.storage ?? window.sessionStorage, options.location ?? window.location, window.history, globalThis.crypto, (window as any).CSS, window.DOMParser,
    window.FormData, window.Blob, globalThis.URL, window.HTMLInputElement, window.HTMLTextAreaElement, window.HTMLSelectElement,
    window.Element, options.confirm ?? (() => false), globalThis.fetch,
  );
  document.dispatchEvent(new window.Event("alpine:init"));
  const snapshot = {
    invoice: { number: "INV-44", invoiceDate: "2026-09-09", currency: "GBP", notes: "", status: "draft", pdfTemplateRevisionId: 1 },
    items: [], generatedTexts: [], records: [], availableRecordTypes: [], partyRefresh: { digest: "party" },
  };
  const state = factory!(encodeURIComponent(JSON.stringify({ invoiceId: 44, baseRevision: 7, snapshot, generators: [] })));
  Object.assign(state, { $root: document.querySelector("[data-invoice-editor]")!, $nextTick: (fn: () => void) => fn(), $watch: () => undefined, announce: (message: string) => { state.statusText = message; } });
  return { window, document, state };
}

describe("invoice workspace browser recovery coordinator", () => {
  test("an unstructured save response keeps the exact frozen operation and mutation lock", async () => {
    const { state } = coordinator();
    const frozen = { operationId: "op-1", editSessionId: "session-1", kind: "save", canonicalPayloadDigest: "digest-1", changes: { setNotes: "keep" } };
    state.frozen = frozen;
    state.expectedIdentity = { operationId: "op-1", editSessionId: "session-1", kind: "save", digest: "digest-1" };
    state.unresolved = true;
    state.request = async () => { throw new Error("The server response could not be matched to this operation."); };

    await state.sendFrozen();

    expect(state.unresolved).toBe(true);
    expect(state.frozen).toEqual(frozen);
    expect(state.expectedIdentity).toEqual({ operationId: "op-1", editSessionId: "session-1", kind: "save", digest: "digest-1" });
    expect(state.statusText).toBe("Checking whether changes were saved…");
  });

  test("only a receipt with the pending operation key, kind, and digest can unfreeze a save", async () => {
    const { state } = coordinator();
    const pending = { operationId: "op-2", editSessionId: "session-2", kind: "save", digest: "digest-2" };
    state.frozen = { ...pending, canonicalPayloadDigest: pending.digest, changes: {} };
    state.expectedIdentity = pending;
    state.unresolved = true;

    for (const result of [
      { outcome: "committed", operationId: "other", kind: "save", digest: "digest-2", resultingRevision: 8, resultingGeneration: 2 },
      { outcome: "committed", operationId: "op-2", kind: "rebase", digest: "digest-2", resultingRevision: 8, resultingGeneration: 2 },
      { outcome: "committed", operationId: "op-2", kind: "save", digest: "other", resultingRevision: 8, resultingGeneration: 2 },
    ]) {
      await state.applyResult(result);
      expect(state.unresolved).toBe(true);
      expect(state.expectedIdentity).toEqual(pending);
      expect(state.frozen.operationId).toBe("op-2");
    }
  });

  test("reload recovery uses only the retained identity and receipt lookup, without opening a new session", async () => {
    const { window, state } = coordinator();
    window.sessionStorage.setItem("pipa:invoice:44:pending", JSON.stringify({ operationId: "op-reload", editSessionId: "session-reload", kind: "save", digest: "digest-reload", startedAt: "now" }));
    let lookup = "";
    state.checkOperation = async (operationId: string, digest: string) => { lookup = `${operationId}:${digest}`; };
    state.request = async () => { throw new Error("must not create an edit session while lookup is pending"); };

    await state.init();

    expect(lookup).toBe("op-reload:digest-reload");
    expect(state.editSessionId).toBe("session-reload");
    expect(state.unresolved).toBe(true);
    expect(state.ready).toBe(false);
  });

  test("a URL fragment remains an identifier-only recovery fallback when session storage is unavailable", () => {
    const storage = { getItem: () => { throw new Error("storage disabled"); }, setItem: () => { throw new Error("storage disabled"); }, removeItem: () => { throw new Error("storage disabled"); } } as unknown as Storage;
    const location = { hash: "#operation=op-fragment&session=session-fragment", pathname: "/invoices/44/edit", search: "" } as unknown as Location;
    const { state } = coordinator({ storage, location });

    expect(state.pendingIdentity()).toEqual({ operationId: "op-fragment", editSessionId: "session-fragment", kind: "save", digest: null });
  });

  test("a storage failure prevents sending a mutation", async () => {
    const storage = { getItem: () => null, setItem: () => { throw new Error("storage disabled"); }, removeItem: () => { throw new Error("storage disabled"); } } as unknown as Storage;
    const location = { get hash() { return ""; }, set hash(_: string) { throw new Error("fragment disabled"); }, pathname: "/invoices/44/edit", search: "" } as unknown as Location;
    const { state } = coordinator({ storage, location });
    state.ready = true;
    state.editableDirty = true;
    state.editSessionId = "session-storage";
    state.persistIdentity = () => false;
    let sends = 0;
    state.sendFrozen = async () => { sends++; };

    await state.save();

    expect(sends).toBe(0);
    expect(state.unresolved).toBe(false);
    expect(state.statusText).toBe("Unsaved changes");
  });

  test("a stale issue can carry notes into an auxiliary save while retaining the rejected document proposal", async () => {
    const { state } = coordinator();
    state.proposal.invoice.notes = "allowed note";
    state.frozen = { changes: { document: { number: "INV-MINE" }, items: { additions: [{ key: "tmp:item" }] }, setNotes: "allowed note" } };
    state.handleConflict({ code: "DOCUMENT_LOCKED", currentStatus: "issued", conflict: { currentSaved: { revision: 8 } } });
    expect(state.documentLocked).toBe(true);
    expect(state.retainedDocumentProposal.document).toEqual({ document: { number: "INV-MINE" }, items: { additions: [{ key: "tmp:item" }] } });
    expect(state.serializeChanges()).toEqual({ setNotes: "allowed note" });

    state.expectedIdentity = { operationId: "aux-1", editSessionId: "session-aux", kind: "save", digest: "aux-digest" };
    state.unresolved = true;
    await state.applyResult({ outcome: "committed", operationId: "aux-1", kind: "save", digest: "aux-digest", resultingRevision: 9, resultingGeneration: 3 });

    expect(state.retainedDocumentProposal.document.document.number).toBe("INV-MINE");
    expect(state.baseRevision).toBe(9);
    expect(state.baseGeneration).toBe(3);
    expect(state.statusText).toBe("Allowed changes saved; document proposal retained");
  });

  test("422 errors keep existing controls mounted and focus the error summary", () => {
    const { document, state } = coordinator();
    const control = document.querySelector("[data-field-path='invoice.notes']")! as HappyHTMLElement;
    state.applyErrors([{ path: "invoice.notes", section: "notes", message: "Notes are required." }]);

    expect(control.getAttribute("aria-invalid")).toBe("true");
    expect(document.querySelector("[data-field-error='invoice.notes']")?.textContent).toBe("Notes are required.");
    expect(document.activeElement?.id).toBe("edit-error-summary");
    expect(document.querySelector("[data-field-path='invoice.notes']")).toBe(control);
  });

  test("a delayed rebase from G1 cannot replace an already adopted G3 base", async () => {
    const { state } = coordinator();
    state.retainedDocumentProposal = { document: { document: { number: "MINE" } } };
    state.proposal.invoice.number = "MINE";
    let resolve!: (value: any) => void;
    state.request = async () => await new Promise((done) => { resolve = done; });
    const pending = state.rebaseAllowed({ currentRevision: 8 });
    await new Promise((done) => setTimeout(done, 0));
    state.baseGeneration = 3;
    state.baseRevision = 10;
    resolve({ outcome: "committed", fromGeneration: 1, toGeneration: 2, observedInvoiceRevision: 8, canonicalBase: state.baseSnapshot });

    await pending;

    expect(state.baseGeneration).toBe(3);
    expect(state.baseRevision).toBe(10);
    expect(state.retainedDocumentProposal.document.document.number).toBe("MINE");
  });

  test("an uncertain rebase retry reuses its exact rebase identity and choices", async () => {
    const { state } = coordinator();
    state.retainedDocumentProposal = { document: { document: { number: "MINE" } } };
    state.proposal.invoice.number = "MINE";
    const payloads: any[] = [];
    state.request = async (_url: string, payload: any) => { payloads.push(payload); throw new Error("response lost"); };

    await state.rebaseAllowed({ currentRevision: 8 });
    await state.rebaseAllowed({ currentRevision: 8 });

    expect(payloads).toHaveLength(2);
    expect(payloads[1]).toMatchObject({ rebaseId: payloads[0].rebaseId, rebaseDigest: payloads[0].rebaseDigest, expectedBaseGeneration: 1, expectedLatestRevision: 8, choices: payloads[0].choices });
  });

  test("repeated auxiliary receipts expose one explicit dismissal control and dismissal clears only the retained proposal", () => {
    const { document, state } = coordinator({ confirm: () => true });
    state.retainedDocumentProposal = { document: { document: { number: "MINE" } } };
    state.showRecoverySaved();
    state.showRecoverySaved();

    const buttons = document.querySelectorAll("#edit-conflict-summary button");
    expect(buttons).toHaveLength(1);
    buttons[0]!.dispatchEvent(new (document.defaultView as any).Event("click"));
    expect(state.retainedDocumentProposal).toBeNull();
  });

  test("a route-shaped error control opens its hidden section and focuses the exact mounted field without replacing an attached File object", async () => {
    const { document, state, window } = coordinator();
    const file = new window.File(["file bytes"], "proof.pdf", { type: "application/pdf" });
    const entry = { uploadId: "upload-1", definitionKey: "proof", file, state: "ready", token: "token-1" };
    state.proposal.records.push({ key: "tmp:record", definitions: { fields: [] }, values: {}, baseValues: {}, files: [entry] });
    const textSection = document.createElement("section");
    textSection.dataset.workspaceSection = "text";
    textSection.hidden = true;
    const control = document.querySelector("[data-field-path='invoice.notes']")! as HappyHTMLElement;
    control.dataset.fieldPath = "setNotes";
    textSection.append(control);
    state.$root.append(textSection);
    const result = document.querySelector("#edit-command-result")!;
    // This is the exact WorkspaceOutcome shape rendered by invoices.routes.tsx.
    result.innerHTML = '<div data-workspace-outcome="rejected"><button type="button" class="link" data-error-path="setNotes">Document notes: Review this field.</button></div>';
    await state.applyResult({ outcome: "rejected", code: "VALIDATION", message: "No changes saved.", fieldErrors: [{ path: "setNotes", section: "text", label: "Document notes", message: "Review this field." }] });
    const errorControl = result.querySelector("[data-error-path='setNotes']")!;
    // Simulate returning to another section before activating the server's
    // accessible error control. Alpine renders `section` via x-show in the app.
    state.section = "document";
    errorControl.dispatchEvent(new window.Event("click", { bubbles: true }));

    expect(state.section).toBe("text");
    expect(document.activeElement).toBe(control);
    expect(state.proposal.records[0].files[0].file).toBe(file);
  });

  test("an unresolved save freezes editable values and blocks row, record, file, and candidate mutations", async () => {
    const { state, window } = coordinator();
    state.config.snapshot.availableRecordTypes = [{ id: 9, name: "Record", digest: "record", definitionsSnapshotJson: '{"fields":[]}', allowMultiple: true }];
    state.proposal.items.push({ key: "id:1", id: 1, name: "Saved", value: "1.00", source: "other", notes: null, removed: false });
    const text = { key: "text", content: "saved", candidate: "candidate", undo: null };
    state.proposal.generatedTexts.push(text);
    const file = new window.File(["bytes"], "proof.pdf");
    const before = structuredClone({ items: state.proposal.items, records: state.proposal.records, text: { ...text } });
    state.unresolved = true;

    state.addItem(); state.removeItem(0); state.addRecord(); state.replaceCandidate(text);
    await state.selectFile({ key: "tmp:record", files: [] }, { key: "proof" }, { target: { files: [file] } });

    expect({ items: state.proposal.items, records: state.proposal.records, text: { ...text } }).toEqual(before);
  });

  test("a save freezes notes even when document controls are locked and hidden", async () => {
    const { state } = coordinator();
    state.ready = true; state.editableDirty = true; state.editSessionId = "freeze-session";
    state.documentLocked = true; state.proposal.invoice.notes = "allowed while issued";
    state.persistIdentity = () => true;
    let frozen: any;
    state.sendFrozen = async () => { frozen = structuredClone(state.frozen); };

    await state.save();

    expect(frozen.changes).toEqual({ setNotes: "allowed while issued" });
    expect(state.unresolved).toBe(true);
  });

  test("generation hashes the exact submitted proposal and displays server failures", async () => {
    const { state } = coordinator();
    const text = { key: "nfse_description", content: "manual", candidate: null as string | null, error: null as string | null };
    state.proposal.generatedTexts.push(text);
    state.request = async (_url: string, payload: any) => {
      expect(payload.inputDigest).toBe(await state.digest({ key: payload.generatorKey, proposal: payload.proposal }));
      return { outcome: "ready", ...payload, candidate: "" };
    };
    await state.generateCandidate(text);
    expect(text.candidate).toBe("");
    expect(text.content).toBe("manual");
    state.request = async () => ({ outcome: "rejected", message: "Template needs review" });
    await state.generateCandidate(text);
    expect(text.error).toBe("Template needs review");
  });

  test("a delayed candidate cannot replace a newer candidate, and typing after a request makes its candidate obsolete", async () => {
    const { state } = coordinator();
    const text: { key: string; content: string; candidate: string | null; undo: string | null } = { key: "text", content: "saved", candidate: null, undo: null };
    state.proposal.generatedTexts.push(text);
    const pending: Array<{ payload: any; resolve: (value: any) => void }> = [];
    state.request = async (_url: string, payload: any) => await new Promise((resolve) => pending.push({ payload, resolve }));

    const candidateA = state.generateCandidate(text);
    await new Promise((done) => setTimeout(done, 0));
    state.proposal.invoice.notes = "typed after A";
    const candidateB = state.generateCandidate(text);
    await new Promise((done) => setTimeout(done, 0));
    pending[1]!.resolve({ outcome: "ready", inputDigest: pending[1]!.payload.inputDigest, sequence: pending[1]!.payload.sequence, candidate: "B" });
    await candidateB;
    pending[0]!.resolve({ outcome: "ready", inputDigest: pending[0]!.payload.inputDigest, sequence: pending[0]!.payload.sequence, candidate: "A" });
    await candidateA;

    expect(text.candidate).toBe("B");

    text.candidate = null;
    const candidateAfterTyping = state.generateCandidate(text);
    await new Promise((done) => setTimeout(done, 0));
    state.proposal.invoice.notes = "typed after request";
    const latest = pending[2]!;
    latest.resolve({ outcome: "ready", inputDigest: latest.payload.inputDigest, sequence: latest.payload.sequence, candidate: "obsolete" });
    await candidateAfterTyping;
    expect(text.candidate).toBeNull();
  });

  test("Save defers during IME composition and sends the frozen operation only after composition ends", async () => {
    const { state } = coordinator();
    state.ready = true; state.editableDirty = true; state.editSessionId = "ime-session";
    state.proposal.invoice.notes = "composed text";
    state.persistIdentity = () => true;
    let sends = 0;
    state.sendFrozen = async () => { sends++; };

    state.compositionStart();
    await state.save();
    expect(sends).toBe(0);
    expect(state.saveAfterComposition).toBe(true);
    expect(state.frozen).toBeNull();

    state.compositionEnd();
    await new Promise((done) => setTimeout(done, 0));
    expect(sends).toBe(1);
    expect(state.frozen.changes).toEqual({ setNotes: "composed text" });
  });

  test("an edit marks an in-flight PDF preview obsolete and prevents its stale result from opening", async () => {
    const { state, window } = coordinator();
    state.ready = true; state.editSessionId = "preview-session";
    let resolve!: (value: any) => void;
    state.request = async () => await new Promise((done) => { resolve = done; });
    let opened = 0;
    (window as any).open = () => { opened++; };

    const pending = state.previewPdf();
    await new Promise((done) => setTimeout(done, 0));
    state.proposal.invoice.notes = "changed after preview request";
    state.markDirty();
    expect(state.preview.obsolete).toBe(true);
    resolve({ url: "/invoices/44/previews/fresh" });
    await pending;

    expect(state.preview.obsolete).toBe(true);
    expect(state.preview.url).toBeUndefined();
    expect(opened).toBe(0);
  });
});
