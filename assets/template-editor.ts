import { Compartment, EditorSelection, EditorState } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  Decoration,
  MatchDecorator,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  undoDepth,
  redoDepth,
  indentWithTab,
  isolateHistory,
  redo,
  selectAll,
  toggleTabFocusMode,
  undo,
} from "@codemirror/commands";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { javascript } from "@codemirror/lang-javascript";
import {
  bracketMatching,
  syntaxHighlighting,
  HighlightStyle,
} from "@codemirror/language";
import { tags } from "@lezer/highlight";
import {
  gotoLine,
  highlightSelectionMatches,
  openSearchPanel,
  searchKeymap,
} from "@codemirror/search";
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
} from "@codemirror/autocomplete";
import { PdfPreviewPanel } from "./pdf-preview.mjs";
import { TemplatePreviewQueue } from "../src/features/pdf-templates/template-preview-queue.ts";
import {
  createTemplateFormatterClient,
  getFormatterForPath,
} from "./template-formatter-client.ts";
import {
  createPreviewDataEditor,
  type PreviewDataPayload,
  type PreviewField,
} from "./template-preview-data.ts";
import { detectTemplatePartyFields } from "./template-field-detection.ts";
import { previewFieldSnippet } from "./template-field-snippet.ts";
import {
  addWorkspaceFile,
  clampPanelState,
  defaultPanelState,
  deleteWorkspaceFile,
  findLiquidOccurrences,
  findReactOccurrences,
  isEditableTextFile,
  isWorkspaceDirty,
  normalisePath,
  normaliseWorkspacePackage,
  renameWorkspaceFile,
  serialiseWorkspacePackage,
  updateWorkspaceFile,
  type PanelState,
  type WorkspaceFile,
  type WorkspacePackage,
} from "../src/features/pdf-templates/template-workspace-state.ts";

const theme = EditorView.theme({
  "&": { height: "100%", color: "#e6edf7", backgroundColor: "#0d1726" },
  ".cm-scroller": {
    overflow: "auto",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: "12px",
    lineHeight: "1.55",
  },
  ".cm-gutters": {
    color: "#8293ad",
    backgroundColor: "#111d2e",
    borderRight: "1px solid #ffffff16",
  },
  ".cm-activeLine": { backgroundColor: "#38bdf812" },
  ".cm-content": { padding: "12px 0" },
  ".cm-line": { padding: "0 12px" },
  ".cm-cursor": { borderLeftColor: "#7dd3fc" },
  "&.cm-focused": { outline: "none" },
  ".cm-liquid": { color: "#f9a8d4", fontWeight: "600" },
});
const highlights = HighlightStyle.define([
  { tag: tags.comment, color: "#9aaac0" },
  { tag: [tags.tagName, tags.typeName], color: "#7dd3fc" },
  { tag: [tags.attributeName, tags.propertyName], color: "#c4b5fd" },
  { tag: [tags.string, tags.attributeValue], color: "#a7f3d0" },
  { tag: [tags.number, tags.unit, tags.color], color: "#fdba74" },
  { tag: [tags.keyword, tags.definitionKeyword], color: "#f9a8d4" },
]);
const liquidTokens = new MatchDecorator({
  regexp: /\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}/g,
  decoration: Decoration.mark({ class: "cm-liquid" }),
});
const liquidHighlight = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = liquidTokens.createDeco(view);
    }
    update(update: ViewUpdate) {
      this.decorations = liquidTokens.updateDeco(update, this.decorations);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);
const wordWrap = new Compartment();

function extensions(
  path: string,
  engine: "gotenberg-html" | "react-pdf",
  editable: boolean,
  wrapEnabled: boolean,
  onChange: (source: string) => void,
) {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    history(),
    drawSelection(),
    bracketMatching(),
    closeBrackets(),
    autocompletion(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    syntaxHighlighting(highlights),
    path.toLowerCase().endsWith(".css")
      ? css()
      : /\.[jt]sx?$/i.test(path)
        ? javascript({
            jsx: /x$/i.test(path),
            typescript: /\.tsx?$/i.test(path),
          })
        : html({ autoCloseTags: true }),
    ...(engine === "gotenberg-html" ? [liquidHighlight] : []),
    theme,
    wordWrap.of(wrapEnabled ? EditorView.lineWrapping : []),
    EditorView.contentAttributes.of({ "aria-label": `Source: ${path}` }),
    EditorState.readOnly.of(!editable),
    keymap.of([
      { key: "Escape", run: toggleTabFocusMode },
      ...defaultKeymap,
      ...historyKeymap,
      ...searchKeymap,
      ...closeBracketsKeymap,
      indentWithTab,
    ]),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) onChange(update.state.doc.toString());
    }),
  ];
}
function must<T extends Element>(root: ParentNode, selector: string): T {
  const item = root.querySelector<T>(selector);
  if (!item) throw new Error(`Template workspace is missing ${selector}`);
  return item;
}
function errorText(response: Response) {
  return response
    .text()
    .then(
      (body) => new Error(body.trim() || "The preview could not be rendered."),
    );
}

function initialise(root: HTMLElement) {
  const form = must<HTMLFormElement>(root, "[data-template-form]"),
    packageInput = must<HTMLInputElement>(root, "[data-template-package]"),
    sourceInput = must<HTMLTextAreaElement>(root, "textarea[name=source]"),
    name = must<HTMLInputElement>(root, "input[name=name]"),
    mount = must<HTMLElement>(root, "[data-template-editor-mount]"),
    tabs = must<HTMLElement>(root, "[data-editor-tabs]"),
    fileList = must<HTMLElement>(root, "[data-file-list]"),
    fileActions = must<HTMLElement>(root, "[data-file-actions]"),
    binaryView = must<HTMLElement>(root, "[data-binary-view]"),
    panelRoot = must<HTMLElement>(root, "[data-template-preview]"),
    status = must<HTMLElement>(root, "[data-template-preview-status]"),
    retry = must<HTMLButtonElement>(root, "[data-template-preview-retry]"),
    dirtyBadge = must<HTMLElement>(root, "[data-template-dirty]"),
    savedBadge = must<HTMLElement>(root, "[data-template-saved]"),
    formatStatus = must<HTMLElement>(root, "[data-format-status]"),
    previewDataRoot = must<HTMLElement>(root, "[data-preview-data-editor]");
  const editable = root.dataset.templateEditable === "true",
    engine =
      root.dataset.templateEngine === "react-pdf"
        ? "react-pdf"
        : "gotenberg-html",
    initialName = name.value,
    initiallyUnsaved = root.dataset.templateInitialDirty === "true";
  let pkg: WorkspacePackage;
  try {
    pkg = normaliseWorkspacePackage(
      JSON.parse(packageInput.value) as WorkspacePackage,
    );
  } catch {
    pkg = {
      version: 1,
      entry: engine === "react-pdf" ? "index.tsx" : "index.html",
      files: [
        {
          path: engine === "react-pdf" ? "index.tsx" : "index.html",
          content: sourceInput.value,
          encoding: "utf8",
        },
      ],
    };
  }
  const initialPackage = structuredClone(pkg),
    editorStates = new Map<string, EditorState>(),
    openTabs: string[] = [pkg.entry];
  let activePath: string = pkg.entry;
  let navigationGeneration = 0;
  let destroyed = false,
    submitting = false,
    previewStarted = false,
    lastPreviewIdentity = "",
    hasSuccessfulPreview = false;
  let previewData: PreviewDataPayload = { version: 1 };
  let previewDataVersion = 0;
  let previewDataDescription = "loading preview values";
  let previewProblem = "";
  let operationProblem = "";
  let formatting = false;
  let wrapEnabled = true;
  const wrapStorageKey = `pipa-template-word-wrap:${root.dataset.templateKey}`;
  try {
    wrapEnabled = localStorage.getItem(wrapStorageKey) !== "false";
  } catch {}
  const formatter = createTemplateFormatterClient();
  const previewPanel = new PdfPreviewPanel(panelRoot),
    observer = new ResizeObserver(() => previewPanel.refresh());
  observer.observe(panelRoot);
  let previewDataEditor: ReturnType<typeof createPreviewDataEditor> | undefined;
  let detectedPackage = pkg;
  let detectionTimer: ReturnType<typeof setTimeout> | undefined;
  let view: EditorView;
  const commit = (content: string) => {
    const active = pkg.files.find((file) => file.path === activePath);
    if (!editable || !active || !isEditableTextFile(active)) return;
    pkg = updateWorkspaceFile(pkg, activePath, content);
    previewProblem = operationProblem = "";
    syncInputs();
    refreshChrome();
    markPreviewStale();
  };
  const makeState = (file: WorkspaceFile) =>
    EditorState.create({
      doc: file.content,
      extensions: extensions(file.path, engine, editable, wrapEnabled, commit),
    });
  view = new EditorView({
    state: makeState(pkg.files.find((f) => f.path === activePath)!),
    parent: mount,
  });

  function syncInputs() {
    packageInput.value = serialiseWorkspacePackage(pkg);
    sourceInput.value =
      pkg.files.find((file) => file.path === pkg.entry)?.content ?? "";
  }
  function isDirty() {
    return (
      initiallyUnsaved ||
      isWorkspaceDirty(initialName, initialPackage, name.value, pkg)
    );
  }
  function refreshChrome() {
    const changed = isDirty();
    dirtyBadge.hidden = !changed;
    savedBadge.hidden = changed;
    const active = pkg.files.find((file) => file.path === activePath);
    const textActive = Boolean(active && isEditableTextFile(active) && !mount.hidden);
    for (const command of ["find", "goto-line", "select-all", "replace", "undo", "redo"]) {
      const button = root.querySelector<HTMLButtonElement>(`[data-editor-command="${command}"]`);
      if (button) button.disabled = !textActive ||
        (["replace", "undo", "redo"].includes(command) && !editable) ||
        (command === "undo" && undoDepth(view.state) === 0) ||
        (command === "redo" && redoDepth(view.state) === 0);
    }
    const formatReason = !editable
      ? "Built-in templates are read-only. Duplicate this template to format it."
      : !active || !isEditableTextFile(active)
        ? "Only editable text files can be formatted."
        : !getFormatterForPath(active.path)
          ? "This file type is not supported by the formatter."
        : formatting
          ? "Formatting is already in progress."
          : "";
    const formatButton = root.querySelector<HTMLButtonElement>(
      '[data-editor-command="format"]',
    );
    if (formatButton) {
      formatButton.disabled = Boolean(formatReason);
      formatButton.title = formatReason;
    }
    const formatReasonLabel = root.querySelector<HTMLElement>("[data-format-reason]");
    if (formatReasonLabel) {
      formatReasonLabel.textContent = formatReason;
      formatReasonLabel.hidden = !formatReason;
    }
    for (const button of root.querySelectorAll<HTMLButtonElement>(
      "[data-insert-field]",
    )) {
      button.disabled = !editable || !active || !isEditableTextFile(active);
    }
    renderFiles();
    renderTabs();
    renderUsedFields();
    if (previewDataEditor && detectedPackage !== pkg) {
      detectedPackage = pkg;
      clearTimeout(detectionTimer);
      detectionTimer = setTimeout(() => {
        if (!destroyed) previewDataEditor?.setDetectedFields(detectTemplatePartyFields(pkg, engine));
      }, 120);
    }
    renderProblems();
  }
  function selectFile(path: string, selection?: { from: number; to: number }) {
    const file = pkg.files.find((item) => item.path === path);
    if (!file) return;
    navigationGeneration++;
    const previous = pkg.files.find((item) => item.path === activePath);
    if (previous && isEditableTextFile(previous) && !mount.hidden)
      editorStates.set(activePath, view.state);
    if (!openTabs.includes(path)) openTabs.push(path);
    if (isEditableTextFile(file)) {
      activePath = path;
      mount.hidden = false;
      binaryView.hidden = true;
      const state = editorStates.get(path) ?? makeState(file);
      view.setState(
        selection
          ? state.update({
              selection: EditorSelection.single(selection.from, selection.to),
              scrollIntoView: true,
            }).state
          : state,
      );
      view.focus();
    } else {
      activePath = path;
      mount.hidden = true;
      binaryView.hidden = false;
      binaryView.innerHTML = `<div class="template-asset-preview"><img alt="Preview of ${escapeHtml(path)}"><p>${escapeHtml(path)}</p></div>`;
      const img = binaryView.querySelector("img")!;
      img.setAttribute("src", `data:${mimeFor(path)};base64,${file.content}`);
    }
    refreshChrome();
  }
  function renderFiles() {
    fileList.replaceChildren(
      ...pkg.files.map((file) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = file.path === activePath ? "is-active" : "";
        button.innerHTML = `<span>${file.path === pkg.entry ? "◆" : isEditableTextFile(file) ? "#" : "▧"}</span><span>${escapeHtml(file.path)}</span>`;
        button.onclick = () => selectFile(file.path);
        return button;
      }),
    );
    fileActions.replaceChildren();
    if (!editable || activePath === pkg.entry) return;
    const rename = document.createElement("button"),
      remove = document.createElement("button");
    rename.type = remove.type = "button";
    rename.textContent = "Rename";
    remove.textContent = "Delete";
    rename.onclick = () => {
      const next = prompt("New relative path", activePath);
      if (!next || next === activePath) return;
      try {
        const nextPath = normalisePath(next),
          old = activePath,
          selection = view.state.selection;
        navigationGeneration++;
        pkg = renameWorkspaceFile(pkg, old, nextPath);
        activePath = nextPath;
        const tab = openTabs.indexOf(old);
        if (tab >= 0) openTabs[tab] = activePath;
        editorStates.delete(old);
        const renamed = pkg.files.find((file) => file.path === nextPath)!;
        if (isEditableTextFile(renamed)) {
          const state = makeState(renamed).update({ selection }).state;
          editorStates.set(nextPath, state);
          view.setState(state);
        } else selectFile(nextPath);
        syncInputs();
        refreshChrome();
        markPreviewStale();
      } catch (error) {
        showProblem((error as Error).message);
      }
    };
    remove.onclick = () => {
      if (!confirm(`Delete ${activePath}?`)) return;
      const removed = activePath;
      pkg = deleteWorkspaceFile(pkg, removed);
      editorStates.delete(removed);
      const tab = openTabs.indexOf(removed);
      if (tab >= 0) openTabs.splice(tab, 1);
      selectFile(pkg.entry);
      syncInputs();
      markPreviewStale();
    };
    fileActions.append(rename, remove);
  }
  function closeTab(path: string) {
    const index = openTabs.indexOf(path);
    if (index < 0) return;
    openTabs.splice(index, 1);
    if (path === activePath) {
      const next = openTabs[Math.max(0, index - 1)] ?? pkg.entry;
      if (!openTabs.includes(next)) openTabs.push(next);
      selectFile(next);
    } else renderTabs();
  }
  function renderTabs() {
    tabs.replaceChildren(
      ...openTabs
        .filter((path) => pkg.files.some((file) => file.path === path))
        .map((path) => {
          const item = document.createElement("div");
          item.className = "template-editor-tab";
          item.setAttribute("aria-selected", String(path === activePath));
          const button = document.createElement("button");
          button.type = "button";
          button.role = "tab";
          button.setAttribute("aria-selected", String(path === activePath));
          button.textContent = path;
          button.onclick = () => selectFile(path);
          const close = document.createElement("button");
          close.type = "button";
          close.className = "template-tab-close";
          close.textContent = "×";
          close.setAttribute("aria-label", `Close ${path}`);
          close.onclick = () => closeTab(path);
          item.append(button, close);
          return item;
        }),
    );
  }
  function renderUsedFields() {
    const target = must<HTMLElement>(root, "[data-used-fields]"),
      occurrences =
        engine === "react-pdf"
          ? findReactOccurrences(pkg)
          : findLiquidOccurrences(pkg);
    target.replaceChildren();
    if (!occurrences.length) {
      target.textContent =
        engine === "react-pdf"
          ? "No document field references found."
          : "No Liquid field references found.";
      return;
    }
    const grouped = new Map<string, typeof occurrences>();
    for (const item of occurrences)
      grouped.set(item.path, [...(grouped.get(item.path) ?? []), item]);
    for (const [path, items] of grouped) {
      const section = document.createElement("section");
      section.innerHTML = `<h3>${escapeHtml(path)}</h3>`;
      for (const item of items) {
        const button = document.createElement("button");
        button.type = "button";
        button.innerHTML = `<code>${escapeHtml(item.field)}</code><span>Ln ${item.line}:${item.column}</span>`;
        button.onclick = () => selectFile(path, item);
        section.append(button);
      }
      target.append(section);
    }
  }
  function findProblems() {
    const result: Array<{ path: string; message: string }> = [];
    for (const message of [operationProblem, previewProblem]) {
      if (message) result.push({ path: "", message });
    }
    if (!pkg.files.some((file) => file.path === pkg.entry))
      result.push({ path: pkg.entry, message: "Entry document is missing." });
    if (engine !== "gotenberg-html") return result;
    for (const file of pkg.files.filter(isEditableTextFile)) {
      for (const match of file.content.matchAll(
        /<(?:img\b[^>]*?\bsrc|link\b[^>]*?\bhref)\s*=\s*["']([^"']+)["']/gi,
      )) {
        const ref = match[1]!;
        if (/^(?:data:|#)/i.test(ref)) continue;
        if (/^(?:[a-z]+:|\/\/|\/)/i.test(ref)) {
          result.push({
            path: file.path,
            message: `External or absolute resource is not allowed: ${ref}`,
          });
          continue;
        }
        const resolved = resolveRelative(
          file.path.endsWith(".liquid") ? pkg.entry : file.path,
          ref.split(/[?#]/)[0]!,
        );
        if (!pkg.files.some((candidate) => candidate.path === resolved))
          result.push({
            path: file.path,
            message: `Missing local file: ${ref}`,
          });
      }
      for (const match of file.content.matchAll(
        /\{%-?\s*render\s+['"]([^'"]+)['"]/gi,
      )) {
        const ref = match[1]!;
        if (!pkg.files.some((candidate) => candidate.path === ref))
          result.push({
            path: file.path,
            message: `Missing Liquid partial: ${ref}`,
          });
      }
    }
    return result;
  }
  function renderProblems() {
    const problems = findProblems(),
      target = must<HTMLElement>(root, "[data-problems]"),
      empty = must<HTMLElement>(root, "[data-problems-empty]"),
      count = must<HTMLElement>(root, "[data-problem-count]");
    empty.hidden = problems.length > 0;
    count.textContent = problems.length ? String(problems.length) : "";
    target.replaceChildren(
      ...problems.map((problem) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = problem.path
          ? `${problem.path}: ${problem.message}`
          : problem.message;
        button.onclick = () => {
          if (problem.path) selectFile(problem.path);
        };
        return button;
      }),
    );
  }
  function showProblem(message: string) {
    operationProblem = message;
    if (!panelState.toolsOpen) {
      panelState.toolsOpen = true;
      applyPanels();
    }
    switchTool("problems");
    renderProblems();
  }
  function markPreviewStale() {
    previewPanel.cancelPending();
    status.textContent = hasSuccessfulPreview
      ? "Out of date — last successful preview remains visible"
      : "Preview is out of date";
    status.dataset.state = "outdated";
    if (panelState.previewOpen) queue.schedule(previewIdentity());
  }

  const previewIdentity = () => JSON.stringify({ packageJson: serialiseWorkspacePackage(pkg), previewData, previewDataVersion });

  const queue = new TemplatePreviewQueue(async (identity) => {
    if (destroyed || !panelState.previewOpen || identity !== previewIdentity()) return;
    const { packageJson, previewData: requestedData } = JSON.parse(identity) as { packageJson: string; previewData: PreviewDataPayload };
    try {
      status.textContent = "Rendering unsaved package…";
      status.dataset.state = "rendering";
      retry.hidden = true;
      const data = new FormData();
      data.set("packageJson", packageJson);
      data.set("engine", engine);
      data.set("previewData", JSON.stringify(requestedData));
      const response = await fetch("/settings/pdf-templates/preview.pdf", {
        method: "POST",
        headers: { Accept: "application/pdf" },
        cache: "no-store",
        body: data,
      });
      if (!response.ok) throw await errorText(response);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (
        destroyed ||
        !panelState.previewOpen ||
        identity !== previewIdentity()
      )
        return;
      const displayed = await previewPanel.loadData(bytes, {
        label: "Unsaved template preview",
      });
      if (
        destroyed ||
        !panelState.previewOpen ||
        identity !== previewIdentity()
      )
        return;
      if (displayed) {
        previewProblem = "";
        renderProblems();
        hasSuccessfulPreview = true;
        lastPreviewIdentity = identity;
        status.textContent = `Unsaved preview · ${previewDataDescription}`;
        status.dataset.state = "ready";
      } else {
        status.textContent = hasSuccessfulPreview
          ? "Could not display the new PDF. The visible preview is out of date."
          : "The PDF was generated but could not be displayed.";
        status.dataset.state = "error";
        retry.hidden = false;
        previewProblem = status.textContent;
        renderProblems();
      }
    } catch (error) {
      if (destroyed || identity !== previewIdentity()) return;
      status.textContent = `${(error as Error).message}${hasSuccessfulPreview ? " The visible preview is out of date." : ""}`;
      status.dataset.state = "error";
      retry.hidden = false;
      previewProblem = (error as Error).message;
      renderProblems();
    }
  });

  function renderAvailableFields(fields: PreviewField[]) {
    const target = must<HTMLElement>(root, "[data-dynamic-available-fields]");
    target.replaceChildren(...fields.map((field) => {
      const button = document.createElement("button");
      button.type = "button";
      const snippet = previewFieldSnippet(field.path, engine);
      button.dataset.insertField = snippet;
      button.disabled = !editable || Boolean(mount.hidden);
      button.innerHTML = `<span><strong>${escapeHtml(field.label)}</strong><code>${escapeHtml(snippet)}</code></span><small>${field.kind} · Insert</small>`;
      button.onclick = () => {
        const active = pkg.files.find((file) => file.path === activePath);
        if (!editable || !active || !isEditableTextFile(active) || mount.hidden) return;
        view.dispatch(view.state.replaceSelection(snippet));
        view.focus();
      };
      return button;
    }));
  }
  previewDataEditor = createPreviewDataEditor(previewDataRoot, (next, nextDescription) => {
    previewData = next;
    previewDataDescription = nextDescription;
    markPreviewStale();
  }, renderAvailableFields, (next, nextDescription) => {
    previewDataVersion++;
    previewData = next;
    previewDataDescription = nextDescription;
    previewPanel.cancelPending();
    status.textContent = hasSuccessfulPreview ? "Out of date — preview values changed" : "Preview values changed";
    status.dataset.state = "outdated";
  }, detectTemplatePartyFields(pkg, engine));

  const storageKey = `pipa-template-workspace:${root.dataset.templateKey}`;
  let panelState: PanelState = { ...defaultPanelState };
  try {
    panelState = clampPanelState(
      {
        ...defaultPanelState,
        ...JSON.parse(localStorage.getItem(storageKey) ?? "{}"),
      },
      innerWidth,
      innerHeight,
    );
  } catch {}
  function applyPanels(openedPreview = false) {
    root.style.setProperty("--files-width", `${panelState.filesWidth}px`);
    root.style.setProperty("--preview-width", `${panelState.previewWidth}px`);
    root.style.setProperty("--tools-height", `${panelState.toolsHeight}px`);
    for (const key of ["files", "preview", "tools"] as const) {
      const open = panelState[`${key}Open`];
      root.classList.toggle(`hide-${key}`, !open);
      const toggle = root.querySelector<HTMLButtonElement>(
        `[data-panel-toggle=${key}]`,
      );
      toggle?.setAttribute("aria-pressed", String(open));
      const position = key === "files" ? "left" : key === "tools" ? "bottom" : "right";
      toggle?.setAttribute("aria-label", `${open ? "Hide" : "Show"} ${position} panel`);
      toggle?.setAttribute("title", `${open ? "Hide" : "Show"} ${position} panel`);
      root.querySelector<HTMLButtonElement>(`[data-editor-command=toggle-${key}]`)
        ?.setAttribute("aria-pressed", String(open));
    }
    try {
      localStorage.setItem(storageKey, JSON.stringify(panelState));
    } catch {}
    if (
      openedPreview &&
      (!previewStarted || lastPreviewIdentity !== previewIdentity())
    ) {
      previewStarted = true;
      queue.retry(previewIdentity());
    }
    requestAnimationFrame(() => previewPanel.refresh());
  }
  function togglePanel(key: "files" | "preview" | "tools") {
      const wasOpen = panelState[`${key}Open`];
      panelState[`${key}Open`] = !wasOpen;
      if (key === "preview" && wasOpen) previewPanel.cancelPending();
      applyPanels(key === "preview" && !wasOpen);
  }
  for (const toggle of root.querySelectorAll<HTMLButtonElement>("[data-panel-toggle]"))
    toggle.onclick = () => togglePanel(toggle.dataset.panelToggle as "files" | "preview" | "tools");
  for (const handle of root.querySelectorAll<HTMLElement>("[data-resizer]"))
    installResizer(handle, (delta) => {
      const key = handle.dataset.resizer!;
      if (key === "files") panelState.filesWidth += delta.x;
      if (key === "preview") panelState.previewWidth -= delta.x;
      if (key === "tools") panelState.toolsHeight -= delta.y;
      panelState = clampPanelState(panelState, innerWidth, innerHeight);
      applyPanels();
    });
  let previewDataOpened = false;
  function switchTool(tab: string) {
    if (tab === "preview-data" && !previewDataOpened) {
      previewDataOpened = true;
      panelState = clampPanelState({ ...panelState, toolsHeight: Math.max(panelState.toolsHeight, 360) }, innerWidth, innerHeight);
      applyPanels();
    }
    for (const button of root.querySelectorAll<HTMLElement>("[data-tool-tab]"))
      button.classList.toggle("is-active", button.dataset.toolTab === tab);
    for (const view of root.querySelectorAll<HTMLElement>("[data-tool-view]"))
      view.hidden = view.dataset.toolView !== tab;
  }
  for (const button of root.querySelectorAll<HTMLButtonElement>(
    "[data-tool-tab]",
  ))
    button.onclick = () => switchTool(button.dataset.toolTab!);
  for (const button of root.querySelectorAll<HTMLButtonElement>(
    "[data-insert-field]",
  ))
    button.onclick = () => {
      const active = pkg.files.find((file) => file.path === activePath);
      if (!editable || !active || !isEditableTextFile(active) || mount.hidden)
        return;
      view.dispatch(view.state.replaceSelection(button.dataset.insertField!));
      view.focus();
    };
  const isApple = /Mac|iPhone|iPad/.test(navigator.platform),
    mod = isApple ? "⌘" : "Ctrl+";
  const shortcuts: Record<string, { label: string; keys: string }> = {
    save: { label: "Save new revision", keys: `${mod}S` },
    undo: { label: "Undo", keys: `${mod}Z` },
    redo: { label: "Redo", keys: isApple ? "⇧⌘Z" : "Ctrl+Y" },
    find: { label: "Find", keys: `${mod}F` },
    replace: { label: "Replace", keys: isApple ? "⌥⌘F" : "Ctrl+H" },
    "goto-line": { label: "Go to line", keys: isApple ? "⌥⌘G" : "Alt+Ctrl+G" },
    "select-all": { label: "Select all", keys: `${mod}A` },
    format: { label: "Format document", keys: isApple ? "⇧⌥F" : "Shift+Alt+F" },
  };
  for (const key of root.querySelectorAll<HTMLElement>("[data-shortcut]"))
    key.textContent = shortcuts[key.dataset.shortcut!]?.keys ?? "";
  const shortcutList = must<HTMLElement>(root, "[data-shortcuts-list]");
  shortcutList.replaceChildren(...Object.values(shortcuts).flatMap(({ label, keys }) => {
    const term = document.createElement("dt"), definition = document.createElement("dd");
    term.textContent = label;
    definition.innerHTML = `<kbd>${escapeHtml(keys)}</kbd>`;
    return [term, definition];
  }));
  const closeMenus = (except?: HTMLDetailsElement) => {
    for (const menu of root.querySelectorAll<HTMLDetailsElement>(".template-editor-menu[open]"))
      if (menu !== except) menu.open = false;
  };
  for (const menu of root.querySelectorAll<HTMLDetailsElement>(".template-editor-menu")) {
    menu.addEventListener("toggle", () => { if (menu.open) closeMenus(menu); });
    menu.querySelector("div")?.addEventListener("click", () => { menu.open = false; });
  }
  const clickAway = (event: PointerEvent) => {
    if (!(event.target as Element).closest?.(".template-editor-menu")) closeMenus();
  };
  document.addEventListener("pointerdown", clickAway);
  function focusEditor() {
    if (!mount.hidden) view.focus();
  }
  async function formatDocument() {
    const file = pkg.files.find((item) => item.path === activePath);
    if (
      formatting ||
      !editable ||
      !file ||
      !isEditableTextFile(file) ||
      !getFormatterForPath(file.path) ||
      mount.hidden
    ) return;
    const capturedPath = activePath,
      capturedSource = file.content,
      capturedDoc = view.state.doc,
      capturedNavigation = navigationGeneration,
      cursorOffset = view.state.selection.main.head;
    formatting = true;
    formatStatus.textContent = `Formatting ${capturedPath}…`;
    refreshChrome();
    try {
      const result = await formatter.format({ path: capturedPath, source: capturedSource, cursorOffset });
      const current = pkg.files.find((item) => item.path === capturedPath);
      if (destroyed || navigationGeneration !== capturedNavigation || activePath !== capturedPath || view.state.doc !== capturedDoc || current?.content !== capturedSource) return;
      if (result.source === capturedSource) {
        formatStatus.textContent = "Already formatted";
        focusEditor();
        return;
      }
      const cursor = Math.max(0, Math.min(result.cursorOffset, result.source.length));
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: result.source },
        selection: EditorSelection.cursor(cursor),
        scrollIntoView: true,
        annotations: isolateHistory.of("full"),
        userEvent: "input.format",
      });
      formatStatus.textContent = `Formatted ${capturedPath}`;
      focusEditor();
    } catch (error) {
      const current = pkg.files.find((item) => item.path === capturedPath);
      if (!destroyed && navigationGeneration === capturedNavigation && activePath === capturedPath && view.state.doc === capturedDoc && current?.content === capturedSource) {
        const message = (error as Error).message;
        formatStatus.textContent = message;
        showProblem(message);
      }
    } finally {
      formatting = false;
      if (!destroyed) {
        if (formatStatus.textContent === `Formatting ${capturedPath}…`)
          formatStatus.textContent = "Formatting cancelled because the file changed";
        refreshChrome();
      }
    }
  }
  const commands: Record<string, () => void | Promise<void>> = {
    save: () => { if (editable) form.requestSubmit(); },
    undo: () => { undo(view); focusEditor(); },
    redo: () => { redo(view); focusEditor(); },
    find: () => { openSearchPanel(view); },
    replace: () => {
      openSearchPanel(view);
      requestAnimationFrame(() => view.dom.querySelector<HTMLInputElement>('.cm-search input[name="replace"]')?.focus());
    },
    "goto-line": () => { gotoLine(view); },
    "select-all": () => { selectAll(view); focusEditor(); },
    format: formatDocument,
    "toggle-files": () => togglePanel("files"),
    "toggle-tools": () => togglePanel("tools"),
    "toggle-preview": () => togglePanel("preview"),
    "word-wrap": () => {
      wrapEnabled = !wrapEnabled;
      const effect = wordWrap.reconfigure(wrapEnabled ? EditorView.lineWrapping : []);
      view.dispatch({ effects: effect });
      for (const [path, state] of editorStates)
        if (path !== activePath) editorStates.set(path, state.update({ effects: effect }).state);
      root.querySelector<HTMLButtonElement>('[data-editor-command="word-wrap"]')?.setAttribute("aria-pressed", String(wrapEnabled));
      try { localStorage.setItem(wrapStorageKey, String(wrapEnabled)); } catch {}
      focusEditor();
    },
    "reset-layout": () => {
      panelState = clampPanelState({ ...defaultPanelState }, innerWidth, innerHeight);
      applyPanels(true);
    },
    shortcuts: () => must<HTMLDialogElement>(root, "[data-shortcuts-dialog]").showModal(),
  };
  root.querySelector<HTMLButtonElement>('[data-editor-command="word-wrap"]')?.setAttribute("aria-pressed", String(wrapEnabled));
  for (const button of root.querySelectorAll<HTMLButtonElement>("[data-editor-command]"))
    button.addEventListener("click", () => void commands[button.dataset.editorCommand!]?.());
  const workspaceKeys = (event: KeyboardEvent) => {
    if (event.key === "Escape" && root.querySelector(".template-editor-menu[open]")) {
      const activeMenu = root.querySelector<HTMLDetailsElement>(".template-editor-menu[open]");
      closeMenus();
      activeMenu?.querySelector<HTMLElement>("summary")?.focus();
      event.preventDefault();
      return;
    }
    const inEditor = view.dom.contains(event.target as Node);
    if (!inEditor && event.target instanceof HTMLInputElement && event.target === name && !(event.key.toLowerCase() === "s" && (event.metaKey || event.ctrlKey))) return;
    const key = event.key.toLowerCase(), primary = event.metaKey || event.ctrlKey;
    let command = primary && key === "s" ? "save" : "";
    if (inEditor && event.shiftKey && event.altKey && key === "f") command = "format";
    if (!command) return;
    event.preventDefault();
    void commands[command]?.();
  };
  root.addEventListener("keydown", workspaceKeys);
  root
    .querySelector<HTMLButtonElement>("[data-add-text]")
    ?.addEventListener("click", () => {
      const path = prompt(
        "Relative file path",
        engine === "react-pdf" ? "components/Header.tsx" : "styles/main.css",
      );
      if (!path) return;
      try {
        const nextPath = normalisePath(path);
        editorStates.delete(nextPath);
        pkg = addWorkspaceFile(pkg, {
          path: nextPath,
          content: nextPath.endsWith(".css") ? "/* Template styles */\n" : "",
          encoding: "utf8",
        });
        syncInputs();
        selectFile(nextPath);
        markPreviewStale();
      } catch (error) {
        showProblem((error as Error).message);
      }
    });
  const assetInput = root.querySelector<HTMLInputElement>("[data-asset-input]");
  root
    .querySelector<HTMLButtonElement>("[data-add-asset]")
    ?.addEventListener("click", () => assetInput?.click());
  assetInput?.addEventListener("change", async () => {
    const file = assetInput.files?.[0];
    if (!file) return;
    try {
      const path = `images/${file.name}`;
      editorStates.delete(path);
      pkg = addWorkspaceFile(pkg, {
        path,
        content: await fileToBase64(file),
        encoding: "base64",
      });
      syncInputs();
      selectFile(path);
      markPreviewStale();
    } catch (error) {
      showProblem((error as Error).message);
    }
    assetInput.value = "";
  });
  name.oninput = refreshChrome;
  retry.onclick = () => queue.retry(previewIdentity());
  form.onsubmit = () => {
    submitting = true;
    syncInputs();
  };
  const beforeUnload = (event: BeforeUnloadEvent) => {
    if (!submitting && isDirty()) {
      event.preventDefault();
      event.returnValue = "";
    }
  };
  window.addEventListener("beforeunload", beforeUnload);
  const pageShow = (event: PageTransitionEvent) => {
    if (event.persisted) {
      submitting = false;
      previewPanel.refresh();
    }
  };
  const resize = () => {
    panelState = clampPanelState(panelState, innerWidth, innerHeight);
    applyPanels();
  };
  const cleanup = (event: PageTransitionEvent) => {
    if (event.persisted || destroyed) return;
    destroyed = true;
    queue.destroy();
    previewPanel.destroy();
    observer.disconnect();
    formatter.dispose();
    clearTimeout(detectionTimer);
    previewDataEditor?.destroy();
    view.destroy();
    document.removeEventListener("pointerdown", clickAway);
    window.removeEventListener("beforeunload", beforeUnload);
    window.removeEventListener("pagehide", cleanup);
    window.removeEventListener("pageshow", pageShow);
    window.removeEventListener("resize", resize);
  };
  window.addEventListener("pagehide", cleanup);
  window.addEventListener("pageshow", pageShow);
  window.addEventListener("resize", resize);
  syncInputs();
  refreshChrome();
  applyPanels(panelState.previewOpen);
}

function installResizer(
  handle: HTMLElement,
  change: (delta: { x: number; y: number }) => void,
) {
  handle.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    let x = event.clientX,
      y = event.clientY;
    const move = (next: PointerEvent) => {
      change({ x: next.clientX - x, y: next.clientY - y });
      x = next.clientX;
      y = next.clientY;
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
  });
  handle.addEventListener("keydown", (event) => {
    const step = event.shiftKey ? 40 : 10;
    if (event.key === "ArrowLeft") change({ x: -step, y: 0 });
    else if (event.key === "ArrowRight") change({ x: step, y: 0 });
    else if (event.key === "ArrowUp") change({ x: 0, y: -step });
    else if (event.key === "ArrowDown") change({ x: 0, y: step });
    else return;
    event.preventDefault();
  });
}
function resolveRelative(from: string, ref: string) {
  const parts = from.split("/");
  parts.pop();
  for (const part of ref.split("/")) {
    if (part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}
function mimeFor(path: string) {
  const ext = path.split(".").pop()?.toLowerCase();
  return ext === "png"
    ? "image/png"
    : ext === "gif"
      ? "image/gif"
      : ext === "webp"
        ? "image/webp"
        : "image/jpeg";
}
function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
}
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.readAsDataURL(file);
  });
}
for (const root of document.querySelectorAll<HTMLElement>(
  "[data-template-editor]",
))
  initialise(root);
