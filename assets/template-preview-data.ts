export type PreviewSourceConfig = {
  version: 1;
  issuerSource: "settings" | "sample" | "empty";
  customerSource: "sample" | "empty" | "client";
  customerClientId?: number;
  invoiceSource: "sample" | "empty";
  items?: PreviewItem[];
};

export type PreviewItem = { name: string; valueMinor: number };
export type DetectedPreviewField = { party: "issuer" | "customer"; key: string; label: string; section: "other" };

export type PreviewField = {
  path: string;
  label: string;
  group: string;
  kind: "text" | "boolean" | "money";
  value: string | boolean;
  emptyValue: string | boolean;
  editable: true;
};

type PreviewResponse = {
  config: PreviewSourceConfig;
  clientOptions: Array<{ id: number; name: string; code: string }>;
  warnings: Array<{ path: string; message: string }>;
  fields: PreviewField[];
  document: { items: Array<PreviewItem & { valueDisplay?: string }> };
};

export type PreviewDataPayload = Partial<PreviewSourceConfig> & { version: 1;
  customFieldDefinitions?: Array<{ party: "issuer" | "customer"; key: string; label: string; section: "identity" | "contact" | "address" | "payment" | "other" }>;
  overrides?: Record<string, string | boolean>;
};

const definitionId = (item: { party: string; key: string }) => `${item.party}:${item.key}`;
const itemPath = /^items\.\d+\./;
const decimalToMinor = (value: string) => {
  if (!value.trim()) return 0;
  const match = value.trim().match(/^(\d+)(?:[.,](\d{0,2}))?$/);
  if (!match) return undefined;
  const result = Number(`${match[1]}${(match[2] ?? "").padEnd(2, "0")}`);
  return Number.isSafeInteger(result) ? result : undefined;
};
const minorToDecimal = (value: number) => `${Math.floor(value / 100)}.${String(value % 100).padStart(2, "0")}`;

const escape = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

export function createPreviewDataEditor(
  root: HTMLElement,
  onChange: (payload: PreviewDataPayload, description: string) => void,
  onFields: (fields: PreviewField[]) => void,
  onPendingEdit: (payload: PreviewDataPayload, description: string) => void,
  initialDetectedFields: DetectedPreviewField[] = [],
) {
  let config: PreviewDataPayload = { version: 1 };
  let fields: PreviewField[] = [];
  let overrides: Record<string, string | boolean> = {};
  let manualDefinitions: NonNullable<PreviewDataPayload["customFieldDefinitions"]> = [];
  let detectedDefinitions: DetectedPreviewField[] = initialDetectedFields;
  let retainedDefinitions: NonNullable<PreviewDataPayload["customFieldDefinitions"]> = [];
  let items: PreviewItem[] | undefined;
  let generation = 0;
  let controller: AbortController | undefined;
  let editTimer: ReturnType<typeof setTimeout> | undefined;
  const status = root.querySelector<HTMLElement>("[data-preview-data-status]")!;

  const customDefinitions = () => {
    const result: NonNullable<PreviewDataPayload["customFieldDefinitions"]> = [];
    const seen = new Set<string>();
    for (const definition of [...manualDefinitions, ...retainedDefinitions, ...detectedDefinitions]) {
      const id = definitionId(definition);
      if (!seen.has(id)) { result.push(definition); seen.add(id); }
    }
    return result;
  };

  const payload = (): PreviewDataPayload => ({
    ...config,
    ...(customDefinitions().length ? { customFieldDefinitions: customDefinitions() } : {}),
    ...(items !== undefined ? { items: items.map((item) => ({ ...item })) } : {}),
    ...(Object.keys(overrides).length ? { overrides: { ...overrides } } : {}),
  });
  const description = () => {
    const customer = config.customerSource === "client" ? "selected customer" : `${config.customerSource ?? "default"} customer`;
    const changed = Object.keys(overrides).filter((path) => !itemPath.test(path)).length;
    const itemSummary = items === undefined ? "source items" : `${items.length} custom item${items.length === 1 ? "" : "s"}`;
    return `${config.issuerSource ?? "default"} company · ${customer} · ${config.invoiceSource ?? "default"} invoice · ${itemSummary}${changed ? ` · ${changed} override${changed === 1 ? "" : "s"}` : ""}`;
  };
  const emit = () => {
    if (root.querySelector('[data-preview-item-amount][aria-invalid="true"]')) return;
    onChange(payload(), description());
  };

  function render(data: PreviewResponse) {
    config = data.config;
    if (items === undefined && data.config.items !== undefined) items = data.config.items.map((item) => ({ ...item }));
    fields = data.fields;
    overrides = Object.fromEntries(Object.entries(overrides).filter(([path]) => fields.some((field) => field.path === path) && !itemPath.test(path)));
    root.querySelectorAll<HTMLSelectElement>("[data-preview-source]").forEach((select) => {
      const key = select.dataset.previewSource as keyof PreviewSourceConfig;
      select.value = String(config[key] ?? "");
    });
    const summary = root.querySelector<HTMLElement>("[data-preview-sources-summary]")!;
    summary.textContent = `${config.issuerSource} company · ${config.customerSource === "client" ? "saved" : config.customerSource} customer`;
    const clientSelect = root.querySelector<HTMLSelectElement>("[data-preview-client]")!;
    clientSelect.replaceChildren(...data.clientOptions.map((client) => {
      const option = document.createElement("option");
      option.value = String(client.id);
      option.textContent = client.code ? `${client.name} (${client.code})` : client.name;
      option.selected = client.id === config.customerClientId;
      return option;
    }));
    clientSelect.hidden = config.customerSource !== "client";
    clientSelect.closest("label")!.hidden = clientSelect.hidden;
    renderItems(items ?? data.document.items.map(({ name, valueMinor }) => ({ name, valueMinor })), items === undefined);
    const grouped = new Map<string, PreviewField[]>();
    for (const field of fields) if (field.group !== "items") grouped.set(field.group, [...(grouped.get(field.group) ?? []), field]);
    const fieldRoot = root.querySelector<HTMLElement>("[data-preview-data-fields]")!;
    fieldRoot.replaceChildren(...[...grouped].map(([group, entries]) => {
      const section = document.createElement("section");
      section.dataset.previewGroup = group;
      section.innerHTML = `<h3>${escape(({ issuer: "Company", customer: "Customer", invoice: "Invoice", items: "Line items", records: "Supporting records" } as Record<string, string>)[group] ?? group)}</h3>`;
      const grid = document.createElement("div");
      grid.className = "template-preview-field-grid";
      for (const field of entries) {
        const label = document.createElement("label");
        label.dataset.previewField = field.path;
        const overridden = Object.hasOwn(overrides, field.path);
        label.classList.toggle("is-overridden", overridden);
        label.innerHTML = `<span><strong>${escape(field.label)}${field.kind === "money" ? " · minor units" : ""}</strong><code title="${escape(field.path)}">${escape(field.path)}${field.kind === "money" ? " · 100 = 1.00" : ""}</code></span>`;
        const multiline = field.kind === "text" && (field.path.includes(".field.") || field.path === "invoice.notes");
        const input = multiline ? document.createElement("textarea") : document.createElement("input");
        if (input instanceof HTMLInputElement) {
          input.type = field.kind === "boolean" ? "checkbox" : field.path === "invoice.dateIso" ? "date" : "text";
          input.checked = Boolean(overridden ? overrides[field.path] : field.value);
          if (field.kind === "money") input.inputMode = "numeric";
        } else input.rows = 1;
        if (field.path === "invoice.currency") input.title = "GBP, USD, EUR, or BRL";
        input.value = String(overridden ? overrides[field.path] : field.value);
        input.setAttribute("aria-label", `${field.label} (${field.path})`);
        const reset = document.createElement("button");
        reset.type = "button";
        reset.textContent = "Reset";
        reset.hidden = !overridden;
        input.oninput = () => {
          overrides[field.path] = input instanceof HTMLInputElement && field.kind === "boolean" ? input.checked : input.value;
          label.classList.add("is-overridden");
          reset.hidden = false;
          onPendingEdit(payload(), description());
          clearTimeout(editTimer);
          editTimer = setTimeout(emit, 280);
        };
        input.onkeydown = (event) => { if (event.key === "Enter" && input instanceof HTMLInputElement) event.preventDefault(); };
        reset.onclick = () => {
          delete overrides[field.path];
          if (input instanceof HTMLInputElement) input.checked = Boolean(field.value);
          input.value = String(field.value);
          label.classList.remove("is-overridden");
          reset.hidden = true;
          emit();
        };
        const actions = document.createElement("span");
        actions.className = "template-preview-field-actions";
        actions.append(reset);
        const definition = customDefinitions().find((item) => `${item.party}.field.${item.key}.value` === field.path);
        if (definition) {
          const id = definitionId(definition);
          const detected = detectedDefinitions.some((item) => definitionId(item) === id);
          const retained = retainedDefinitions.some((item) => definitionId(item) === id);
          const badge = document.createElement("small");
          badge.className = "template-preview-field-origin";
          badge.textContent = detected ? "From template" : retained ? "Retained sample" : "Preview-only";
          actions.append(badge);
          if (!detected) {
            const remove = document.createElement("button");
            remove.type = "button";
            remove.textContent = "Remove";
            remove.setAttribute("aria-label", `Remove preview-only field ${definition.label}`);
            remove.onclick = () => {
              manualDefinitions = manualDefinitions.filter((item) => definitionId(item) !== id);
              retainedDefinitions = retainedDefinitions.filter((item) => definitionId(item) !== id);
              delete overrides[field.path];
              onPendingEdit(payload(), description());
              void load();
            };
            actions.append(remove);
          }
        }
        label.append(input, actions);
        grid.append(label);
      }
      section.append(grid);
      return section;
    }));
    status.textContent = data.warnings.length ? data.warnings.map((item) => item.message).join(" ") : "Preview only. Your saved data stays unchanged.";
    status.dataset.state = data.warnings.length ? "warning" : "ready";
    applySearch();
    onFields(fields);
    emit();
  }

  function renderItems(rows: PreviewItem[], inherited: boolean) {
    const itemRoot = root.querySelector<HTMLElement>("[data-preview-items]")!;
    const list = itemRoot.querySelector<HTMLElement>("[data-preview-item-list]")!;
    itemRoot.querySelector<HTMLElement>("[data-preview-items-mode]")!.textContent = inherited ? "Using rows from the selected source" : "Custom preview rows";
    itemRoot.querySelector<HTMLButtonElement>("[data-preview-add-item]")!.disabled = rows.length >= 100;
    list.replaceChildren(...rows.map((row, index) => {
      const entry = document.createElement("div");
      entry.className = "template-preview-item";
      entry.innerHTML = `<label><span>Item ${index + 1}</span><input data-preview-item-name maxlength="500" aria-label="Item ${index + 1} name"></label><label><span>Amount · decimal</span><input data-preview-item-amount inputmode="decimal" aria-label="Item ${index + 1} amount" value="${minorToDecimal(row.valueMinor)}"></label>`;
      const name = entry.querySelector<HTMLInputElement>("[data-preview-item-name]")!;
      name.value = row.name;
      const amount = entry.querySelector<HTMLInputElement>("[data-preview-item-amount]")!;
      const remove = document.createElement("button");
      remove.type = "button"; remove.textContent = "Remove"; remove.setAttribute("aria-label", `Remove item ${index + 1}`);
      const ensureExplicit = () => { if (items === undefined) items = rows.map((item) => ({ ...item })); };
      name.oninput = () => { ensureExplicit(); items![index]!.name = name.value; pendingItems(); };
      amount.oninput = () => {
        const valueMinor = decimalToMinor(amount.value);
        amount.setAttribute("aria-invalid", String(valueMinor === undefined));
        if (valueMinor === undefined) {
          clearTimeout(editTimer);
          onPendingEdit(payload(), description());
          status.textContent = "Enter a nonnegative amount with up to two decimal places.";
          status.dataset.state = "error";
          return;
        }
        status.textContent = "Preview only. Your saved data stays unchanged.";
        status.dataset.state = "ready";
        ensureExplicit(); items![index]!.valueMinor = valueMinor; pendingItems();
      };
      remove.onclick = () => { ensureExplicit(); items!.splice(index, 1); onPendingEdit(payload(), description()); void load(); };
      entry.append(remove);
      return entry;
    }));
  }

  function pendingItems() {
    onPendingEdit(payload(), description());
    clearTimeout(editTimer);
    editTimer = setTimeout(emit, 280);
  }

  async function load() {
    const current = ++generation;
    clearTimeout(editTimer);
    controller?.abort();
    controller = new AbortController();
    status.textContent = "Loading preview values…";
    status.dataset.state = "loading";
    root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement>("[data-preview-data-fields] input, [data-preview-data-fields] textarea, [data-preview-data-fields] button, [data-preview-items] input, [data-preview-items] button").forEach((input) => { input.disabled = true; });
    try {
      const body = new FormData();
      body.set("previewData", JSON.stringify(payload()));
      const response = await fetch("/settings/pdf-templates/preview-data", { method: "POST", headers: { Accept: "application/json" }, cache: "no-store", body, signal: controller.signal });
      if (!response.ok) {
        const error = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(error.error || "Preview values could not be loaded.");
      }
      const data = await response.json() as PreviewResponse;
      if (current === generation) render(data);
    } catch (error) {
      if ((error as Error).name !== "AbortError" && current === generation) {
        status.textContent = (error as Error).message;
        status.dataset.state = "error";
        root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement>("[data-preview-data-fields] input, [data-preview-data-fields] textarea, [data-preview-data-fields] button, [data-preview-items] input, [data-preview-items] button").forEach((input) => { input.disabled = false; });
      }
    }
  }

  root.querySelectorAll<HTMLSelectElement>("[data-preview-source]").forEach((select) => {
    select.onchange = () => {
      const key = select.dataset.previewSource as "issuerSource" | "customerSource" | "invoiceSource";
      config = { ...config, [key]: select.value };
      if (key === "invoiceSource") { items = undefined; delete config.items; }
      const prefixes = key === "issuerSource" ? ["issuer."] : key === "customerSource" ? ["customer.", "records."] : ["invoice.", "items.", "records."];
      overrides = Object.fromEntries(Object.entries(overrides).filter(([path]) => !prefixes.some((prefix) => path.startsWith(prefix))));
      if (key === "customerSource") {
        const clientSelect = root.querySelector<HTMLSelectElement>("[data-preview-client]")!;
        clientSelect.hidden = select.value !== "client";
        clientSelect.closest("label")!.hidden = clientSelect.hidden;
        if (select.value === "client") config.customerClientId = Number(clientSelect.value) || undefined;
        else delete config.customerClientId;
      }
      onPendingEdit(payload(), description());
      void load();
    };
  });
  root.querySelector<HTMLSelectElement>("[data-preview-client]")!.onchange = (event) => {
    config.customerClientId = Number((event.currentTarget as HTMLSelectElement).value) || undefined;
    overrides = Object.fromEntries(Object.entries(overrides).filter(([path]) => !path.startsWith("customer.") && !path.startsWith("records.")));
    onPendingEdit(payload(), description());
    void load();
  };
  root.querySelector<HTMLButtonElement>("[data-preview-reset-overrides]")!.onclick = () => {
    overrides = {};
    onPendingEdit(payload(), description());
    void load();
  };
  root.querySelector<HTMLButtonElement>("[data-preview-empty-all]")!.onclick = () => {
    overrides = {};
    items = undefined;
    config = { version: 1, issuerSource: "empty", customerSource: "empty", invoiceSource: "empty" };
    onPendingEdit(payload(), description());
    void load();
  };
  root.querySelector<HTMLButtonElement>("[data-preview-restore-samples]")!.onclick = () => {
    overrides = {};
    items = undefined;
    manualDefinitions = [];
    retainedDefinitions = [];
    config = { version: 1, issuerSource: "sample", customerSource: "sample", invoiceSource: "sample" };
    onPendingEdit(payload(), description());
    void load();
  };
  root.querySelector<HTMLButtonElement>("[data-preview-add-field]")!.onclick = () => {
    const party = root.querySelector<HTMLSelectElement>("[data-preview-custom-party]")!.value as "issuer" | "customer";
    const keyInput = root.querySelector<HTMLInputElement>("[data-preview-custom-key]")!;
    const labelInput = root.querySelector<HTMLInputElement>("[data-preview-custom-label]")!;
    const section = root.querySelector<HTMLSelectElement>("[data-preview-custom-section]")!.value as "identity" | "contact" | "address" | "payment" | "other";
    const key = keyInput.value.trim().toLowerCase();
    const label = labelInput.value.trim();
    if (!/^[a-z][a-z0-9_]*$/.test(key) || ["__proto__", "prototype", "constructor"].includes(key) || !label) {
      status.textContent = "Custom fields need a label and a key using lowercase letters, numbers, and underscores.";
      status.dataset.state = "error";
      return;
    }
    if (customDefinitions().some((item) => item.party === party && item.key === key)) {
      status.textContent = "That preview-only field already exists.";
      status.dataset.state = "error";
      return;
    }
    manualDefinitions.push({ party, key, label, section });
    keyInput.value = labelInput.value = "";
    onPendingEdit(payload(), description());
    void load();
  };
  function applySearch() {
    const term = root.querySelector<HTMLInputElement>("[data-preview-field-search]")!.value.trim().toLowerCase();
    const group = root.querySelector<HTMLSelectElement>("[data-preview-group-filter]")!.value;
    root.querySelector<HTMLElement>("[data-preview-items]")!.hidden = Boolean(group && group !== "items");
    root.querySelector<HTMLElement>(".template-preview-custom-field")!.hidden = Boolean(group && group !== "issuer" && group !== "customer");
    root.querySelectorAll<HTMLElement>("[data-preview-field]").forEach((item) => {
      const section = item.closest<HTMLElement>("section");
      const matchesGroup = !group || section?.dataset.previewGroup === group;
      item.hidden = !matchesGroup || Boolean(term && !item.textContent?.toLowerCase().includes(term));
    });
    root.querySelectorAll<HTMLElement>("[data-preview-data-fields] section").forEach((section) => {
      section.hidden = !section.querySelector("[data-preview-field]:not([hidden])");
    });
  }
  root.querySelector<HTMLInputElement>("[data-preview-field-search]")!.oninput = applySearch;
  root.querySelector<HTMLSelectElement>("[data-preview-group-filter]")!.onchange = applySearch;
  root.querySelector<HTMLButtonElement>("[data-preview-add-item]")!.onclick = () => {
    if (items === undefined) {
      items = fields.filter((field) => field.group === "items" && field.path.endsWith(".name")).map((field) => ({
        name: String(overrides[field.path] ?? field.value),
        valueMinor: Number(fields.find((candidate) => candidate.path === field.path.replace(/\.name$/, ".valueMinor"))?.value ?? 0),
      }));
    }
    if (items.length >= 100) return;
    items.push({ name: "", valueMinor: 0 });
    onPendingEdit(payload(), description());
    void load();
  };
  root.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.target instanceof HTMLInputElement) event.preventDefault();
  });
  void load();
  let detectedTimer: ReturnType<typeof setTimeout> | undefined;
  const setDetectedFields = (definitions: DetectedPreviewField[]) => {
    const normalized = definitions.filter((item, index) => definitions.findIndex((candidate) => definitionId(candidate) === definitionId(item)) === index);
    if (JSON.stringify(normalized) === JSON.stringify(detectedDefinitions)) return;
    const nextIds = new Set(normalized.map(definitionId));
    for (const previous of detectedDefinitions) {
      if (nextIds.has(definitionId(previous))) continue;
      const path = `${previous.party}.field.${previous.key}.value`;
      const value = overrides[path];
      if (typeof value === "string" && !manualDefinitions.some((item) => definitionId(item) === definitionId(previous)))
        retainedDefinitions.push({ ...previous });
    }
    retainedDefinitions = retainedDefinitions.filter((item) => !nextIds.has(definitionId(item)));
    detectedDefinitions = normalized;
    onPendingEdit(payload(), description());
    clearTimeout(detectedTimer);
    detectedTimer = setTimeout(() => void load(), 180);
  };
  return { payload, description, setDetectedFields, destroy: () => { generation++; controller?.abort(); clearTimeout(editTimer); clearTimeout(detectedTimer); } };
}
