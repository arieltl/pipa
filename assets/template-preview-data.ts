export type PreviewSourceConfig = {
  version: 1;
  issuerSource: "settings" | "sample" | "empty";
  customerSource: "sample" | "empty" | "client";
  customerClientId?: number;
  invoiceSource: "sample" | "empty";
};

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
};

export type PreviewDataPayload = Partial<PreviewSourceConfig> & { version: 1;
  customFieldDefinitions?: Array<{ party: "issuer" | "customer"; key: string; label: string; section: "identity" | "contact" | "address" | "payment" | "other" }>;
  overrides?: Record<string, string | boolean>;
};

const escape = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

export function createPreviewDataEditor(
  root: HTMLElement,
  onChange: (payload: PreviewDataPayload, description: string) => void,
  onFields: (fields: PreviewField[]) => void,
  onPendingEdit: (payload: PreviewDataPayload, description: string) => void,
) {
  let config: PreviewDataPayload = { version: 1 };
  let fields: PreviewField[] = [];
  let overrides: Record<string, string | boolean> = {};
  let customFieldDefinitions: NonNullable<PreviewDataPayload["customFieldDefinitions"]> = [];
  let generation = 0;
  let controller: AbortController | undefined;
  let editTimer: ReturnType<typeof setTimeout> | undefined;
  const status = root.querySelector<HTMLElement>("[data-preview-data-status]")!;

  const payload = (): PreviewDataPayload => ({
    ...config,
    ...(customFieldDefinitions.length ? { customFieldDefinitions: [...customFieldDefinitions] } : {}),
    ...(Object.keys(overrides).length ? { overrides: { ...overrides } } : {}),
  });
  const description = () => {
    const customer = config.customerSource === "client" ? "selected customer" : `${config.customerSource ?? "default"} customer`;
    const changed = Object.keys(overrides).length;
    return `${config.issuerSource ?? "default"} company · ${customer} · ${config.invoiceSource ?? "default"} invoice${changed ? ` · ${changed} override${changed === 1 ? "" : "s"}` : ""}`;
  };
  const emit = () => onChange(payload(), description());

  function render(data: PreviewResponse) {
    config = data.config;
    fields = data.fields;
    overrides = Object.fromEntries(Object.entries(overrides).filter(([path]) => fields.some((field) => field.path === path)));
    root.querySelectorAll<HTMLSelectElement>("[data-preview-source]").forEach((select) => {
      const key = select.dataset.previewSource as keyof PreviewSourceConfig;
      select.value = String(config[key] ?? "");
    });
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
    const grouped = new Map<string, PreviewField[]>();
    for (const field of fields) grouped.set(field.group, [...(grouped.get(field.group) ?? []), field]);
    const fieldRoot = root.querySelector<HTMLElement>("[data-preview-data-fields]")!;
    fieldRoot.replaceChildren(...[...grouped].map(([group, entries]) => {
      const section = document.createElement("section");
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
        const definition = customFieldDefinitions.find((item) => `${item.party}.field.${item.key}.value` === field.path);
        if (definition) {
          const remove = document.createElement("button");
          remove.type = "button";
          remove.textContent = "Remove";
          remove.setAttribute("aria-label", `Remove preview-only field ${definition.label}`);
          remove.onclick = () => {
            customFieldDefinitions = customFieldDefinitions.filter((item) => item !== definition);
            delete overrides[field.path];
            onPendingEdit(payload(), description());
            void load();
          };
          actions.append(remove);
        }
        label.append(input, actions);
        grid.append(label);
      }
      section.append(grid);
      return section;
    }));
    status.textContent = data.warnings.length ? data.warnings.map((item) => item.message).join(" ") : "Preview-only values. Actual settings, customers, and revisions are unchanged.";
    status.dataset.state = data.warnings.length ? "warning" : "ready";
    applySearch();
    onFields(fields);
    emit();
  }

  async function load() {
    const current = ++generation;
    clearTimeout(editTimer);
    controller?.abort();
    controller = new AbortController();
    status.textContent = "Loading preview values…";
    status.dataset.state = "loading";
    root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement>("[data-preview-data-fields] input, [data-preview-data-fields] textarea, [data-preview-data-fields] button").forEach((input) => { input.disabled = true; });
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
        root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement>("[data-preview-data-fields] input, [data-preview-data-fields] textarea, [data-preview-data-fields] button").forEach((input) => { input.disabled = false; });
      }
    }
  }

  root.querySelectorAll<HTMLSelectElement>("[data-preview-source]").forEach((select) => {
    select.onchange = () => {
      const key = select.dataset.previewSource as "issuerSource" | "customerSource" | "invoiceSource";
      config = { ...config, [key]: select.value };
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
    config = { version: 1, issuerSource: "empty", customerSource: "empty", invoiceSource: "empty" };
    onPendingEdit(payload(), description());
    void load();
  };
  root.querySelector<HTMLButtonElement>("[data-preview-restore-samples]")!.onclick = () => {
    overrides = {};
    customFieldDefinitions = [];
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
    if (customFieldDefinitions.some((item) => item.party === party && item.key === key)) {
      status.textContent = "That preview-only field already exists.";
      status.dataset.state = "error";
      return;
    }
    customFieldDefinitions.push({ party, key, label, section });
    keyInput.value = labelInput.value = "";
    onPendingEdit(payload(), description());
    void load();
  };
  function applySearch() {
    const term = root.querySelector<HTMLInputElement>("[data-preview-field-search]")!.value.trim().toLowerCase();
    root.querySelectorAll<HTMLElement>("[data-preview-field]").forEach((item) => {
      item.hidden = Boolean(term && !item.textContent?.toLowerCase().includes(term));
    });
  }
  root.querySelector<HTMLInputElement>("[data-preview-field-search]")!.oninput = applySearch;
  root.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.target instanceof HTMLInputElement) event.preventDefault();
  });
  void load();
  return { payload, description, destroy: () => { generation++; controller?.abort(); clearTimeout(editTimer); } };
}
