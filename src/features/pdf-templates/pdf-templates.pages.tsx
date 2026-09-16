import type { PdfTemplate, PdfTemplateRevision } from "../../db/schema.ts";
import { PageHeader } from "../../web/components/page-header.tsx";
import { Alert, type FieldErrors } from "../../web/components/forms.tsx";
import type { GotenbergStatus } from "./pdf-engine-status.ts";

export type HtmlTemplateValues = {
  name: string;
  source: string;
  packageJson?: string;
  engine?: "gotenberg-html" | "react-pdf";
};

export function PdfTemplatesPage({
  templates,
  engine,
  errors = {},
  gotenbergStatus,
  revisionNumbers = {},
}: {
  templates: PdfTemplate[];
  engine?: string;
  values?: HtmlTemplateValues;
  errors?: FieldErrors;
  gotenbergStatus: GotenbergStatus;
  revisionNumbers?: Record<number, number>;
}) {
  return (
    <div class="template-library">
      <PageHeader
        title="PDF templates"
        description="Create and maintain the layouts used for invoice PDFs."
        actions={
          <div class="dropdown dropdown-end">
            <button type="button" tabindex={0} class="btn btn-primary btn-sm">
              New template
            </button>
            <ul
              tabindex={0}
              class="dropdown-content menu z-10 mt-2 w-56 rounded-box border border-base-300 bg-base-100 p-2 shadow-xl"
            >
              <li>
                <a href="/settings/pdf-templates/new">HTML / Liquid</a>
              </li>
              <li>
                <a href="/settings/pdf-templates/new?engine=react-pdf">
                  React PDF
                </a>
              </li>
            </ul>
          </div>
        }
      />
      {errors._form ? (
        <div class="mb-4">
          <Alert kind="error" message={errors._form} />
        </div>
      ) : null}
      <div class="template-library-bar">
        <div class="flex gap-1" aria-label="Filter templates">
          <FilterLink
            href="/settings/pdf-templates"
            label="All"
            active={!engine}
          />
          <FilterLink
            href="/settings/pdf-templates?engine=gotenberg-html"
            label="HTML / Liquid"
            active={engine === "gotenberg-html"}
          />
          <FilterLink
            href="/settings/pdf-templates?engine=react-pdf"
            label="React PDF"
            active={engine === "react-pdf"}
          />
        </div>
        <form
          method="post"
          action="/settings/pdf-templates/import"
          enctype="multipart/form-data"
        >
          <label class="btn btn-ghost btn-sm">
            Import file or ZIP
            <input
              name="file"
              type="file"
              class="sr-only"
              required
              onchange="this.form.requestSubmit()"
            />
          </label>
        </form>
      </div>
      <GotenbergStatusCard status={gotenbergStatus} compact />
      <div class="template-library-grid">
        {templates.map((template) => (
          <a
            href={`/settings/pdf-templates/${template.id}`}
            class="template-card"
          >
            <div class="template-card-icon" aria-hidden="true">
              {template.engine === "react-pdf" ? "P" : "<>"}
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <h2 class="truncate font-semibold">{template.name}</h2>
                {template.sourceKind === "builtin" ? (
                  <span class="badge badge-ghost badge-xs">Built in</span>
                ) : null}
              </div>
              <p>
                {template.engine === "react-pdf"
                  ? "React PDF, TSX and local assets"
                  : "HTML, Liquid and local assets"}
              </p>
            </div>
            <div class="template-card-meta">
              <span>Revision {revisionNumbers[template.id] ?? "—"}</span>
              <span aria-hidden="true">→</span>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}

export function GotenbergStatusCard({
  status,
  compact = false,
}: {
  status: GotenbergStatus;
  compact?: boolean;
}) {
  const badgeClass =
    status.state === "healthy"
      ? "badge-success"
      : status.state === "unconfigured"
        ? "badge-ghost"
        : "badge-warning";
  return (
    <div
      id="gotenberg-status"
      class={compact ? "template-engine-strip" : "app-card mb-5 rounded-xl p-4"}
    >
      <div class="min-w-0 flex-1">
        <span class={`badge badge-sm ${badgeClass}`}>{status.state}</span>
        <span class="ml-2 text-sm text-base-content/65">
          HTML renderer: {status.message}
        </span>
      </div>
      <button
        type="button"
        class="btn btn-ghost btn-xs"
        hx-post="/settings/pdf-templates/engine-check"
        hx-target="#gotenberg-status"
        hx-swap="outerHTML"
      >
        Check
      </button>
    </div>
  );
}
function FilterLink({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <a href={href} class={`btn btn-sm ${active ? "btn-neutral" : "btn-ghost"}`}>
      {label}
    </a>
  );
}

export function PdfTemplateNewPage({
  values,
  engine = values?.engine ?? "gotenberg-html",
  errors = {},
  gotenbergStatus,
}: {
  values?: HtmlTemplateValues;
  engine?: "gotenberg-html" | "react-pdf";
  errors?: FieldErrors;
  gotenbergStatus: GotenbergStatus;
}) {
  const resolvedValues = values ?? {
    name: "Untitled template",
    source:
      engine === "react-pdf"
        ? defaultReactTemplateSource
        : defaultTemplateSource,
    engine,
  };
  return (
    <TemplateWorkspace
      action="/settings/pdf-templates"
      values={resolvedValues}
      errors={errors}
      gotenbergStatus={gotenbergStatus}
      submitLabel="Create template"
      templateKey="new"
      revision={0}
      revisions={[]}
      editable
      engine={engine}
    />
  );
}

export function PdfTemplateDetailPage({
  template,
  revision,
  revisions,
  values,
  errors = {},
  gotenbergStatus,
}: {
  template: PdfTemplate;
  revision: PdfTemplateRevision;
  revisions: PdfTemplateRevision[];
  values: HtmlTemplateValues;
  errors?: FieldErrors;
  renderedSample?: string;
  gotenbergStatus: GotenbergStatus;
}) {
  return (
    <TemplateWorkspace
      action={`/settings/pdf-templates/${template.id}/revisions`}
      values={values}
      errors={errors}
      gotenbergStatus={gotenbergStatus}
      submitLabel="Save new revision"
      templateKey={String(template.id)}
      templateId={template.id}
      revision={revision.revision}
      revisions={revisions}
      editable={template.sourceKind !== "builtin"}
      engine={template.engine as "gotenberg-html" | "react-pdf"}
    />
  );
}

function TemplateWorkspace({
  action,
  values,
  errors,
  gotenbergStatus,
  submitLabel,
  templateKey,
  templateId,
  revision,
  revisions,
  editable,
  engine,
}: {
  action: string;
  values: HtmlTemplateValues;
  errors: FieldErrors;
  gotenbergStatus: GotenbergStatus;
  submitLabel: string;
  templateKey: string;
  templateId?: number;
  revision: number;
  revisions: PdfTemplateRevision[];
  editable: boolean;
  engine: "gotenberg-html" | "react-pdf";
}) {
  const packageJson =
    values.packageJson ??
    JSON.stringify({
      version: 1,
      entry: engine === "react-pdf" ? "index.tsx" : "index.html",
      files: [
        {
          path: engine === "react-pdf" ? "index.tsx" : "index.html",
          content: values.source,
          encoding: "utf8",
        },
      ],
    });
  return (
    <section
      data-template-editor
      data-template-key={templateKey}
      data-template-editable={editable ? "true" : "false"}
      data-template-engine={engine}
      data-template-initial-dirty={
        Boolean(
          revision === 0 ||
          errors._form ||
          errors.name ||
          errors.source ||
          errors.packageJson,
        )
          ? "true"
          : undefined
      }
      class="template-workspace"
    >
      <form
        method="post"
        action={action}
        enctype="multipart/form-data"
        data-template-form
        class="contents"
      >
        <header class="template-workspace-toolbar">
          <a href="/settings/pdf-templates" class="template-icon-button" aria-label="Back to template library" title="Back to template library">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 5-7 7 7 7M5 12h14" /></svg>
          </a>
          <nav class="template-workspace-menus" aria-label="Editor menus">
            <EditorMenu label="File">
              {editable ? <MenuButton command="save">{submitLabel} <kbd data-shortcut="save" /></MenuButton> : null}
              {templateId ? <a href={`/settings/pdf-templates/${templateId}/source`}>Export saved revision <small>Unsaved edits excluded</small></a> : null}
            </EditorMenu>
            <EditorMenu label="Edit">
              <MenuButton command="undo">Undo <kbd data-shortcut="undo" /></MenuButton>
              <MenuButton command="redo">Redo <kbd data-shortcut="redo" /></MenuButton>
              <span class="template-menu-separator" />
              <MenuButton command="find">Find <kbd data-shortcut="find" /></MenuButton>
              <MenuButton command="replace">Replace <kbd data-shortcut="replace" /></MenuButton>
              <MenuButton command="goto-line">Go to line <kbd data-shortcut="goto-line" /></MenuButton>
              <MenuButton command="select-all">Select all <kbd data-shortcut="select-all" /></MenuButton>
              <span class="template-menu-separator" />
              <MenuButton command="format">Format document <kbd data-shortcut="format" /></MenuButton>
              <small data-format-reason class="template-menu-hint" hidden></small>
            </EditorMenu>
            <EditorMenu label="View">
              <MenuButton command="toggle-files" checked>Left panel</MenuButton>
              <MenuButton command="toggle-tools" checked>Bottom panel</MenuButton>
              <MenuButton command="toggle-preview" checked>Right panel</MenuButton>
              <span class="template-menu-separator" />
              <MenuButton command="word-wrap" checked>Word wrap</MenuButton>
              <MenuButton command="reset-layout">Reset layout</MenuButton>
            </EditorMenu>
            <EditorMenu label="Help">
              <MenuButton command="shortcuts">Keyboard shortcuts</MenuButton>
              <a href="/public/template-author-reference.txt" target="_blank" rel="noopener">Template author reference</a>
            </EditorMenu>
          </nav>
          <div class="template-title-field">
            <label class="template-title-input">
              <input
                name="name"
                value={values.name}
                maxlength={120}
                readonly={!editable}
                aria-label="Template name"
              />
              {editable ? <svg class="template-title-pencil" viewBox="0 0 24 24" aria-hidden="true"><path d="m16 3 5 5-12 12-6 1 1-6L16 3Zm-3 3 5 5" /></svg> : null}
            </label>
            <span>Revision {revision || "draft"}</span>
          </div>
          <span data-format-status class="template-format-status" role="status" aria-live="polite"></span>
          <div class="template-toolbar-spacer" />
          <span class="badge badge-outline badge-sm">
            {engine === "react-pdf" ? "React PDF" : "HTML / Liquid"}
          </span>
          <span data-template-dirty class="template-save-state" hidden>
            Unsaved
          </span>
          <span data-template-saved class="template-save-state">
            Saved
          </span>
          <PanelToggle panel="files" label="left" />
          <PanelToggle panel="tools" label="bottom" />
          <PanelToggle panel="preview" label="right" />
          {templateId ? <a href={`/settings/pdf-templates/${templateId}/source`} class="btn btn-ghost btn-xs" title="Export saved revision — unsaved edits are excluded">Export</a> : null}
          {editable ? (
            <button type="submit" class="btn btn-primary btn-sm">
              {submitLabel}
            </button>
          ) : (
            <button
              type="submit"
              formaction={`/settings/pdf-templates/${templateId}/duplicate`}
              class="btn btn-primary btn-sm"
            >
              Duplicate to edit
            </button>
          )}
        </header>
        {errors._form || errors.name || errors.source || errors.packageJson ? (
          <div class="template-form-error">
            <Alert
              kind="error"
              message={
                errors._form ??
                errors.name ??
                errors.packageJson ??
                errors.source ??
                "Invalid template"
              }
            />
          </div>
        ) : null}
        <input
          type="hidden"
          name="packageJson"
          value={packageJson}
          data-template-package
        />
        <input type="hidden" name="engine" value={engine} />
        <textarea name="source" hidden>
          {values.source}
        </textarea>
        <div class="template-workspace-body">
          <aside class="template-files-panel" data-panel="files">
            <div class="template-panel-heading">
              <strong>Files</strong>
              {editable ? (
                <div>
                  <button
                    type="button"
                    data-add-text
                    title="New text file"
                    aria-label="New text file"
                  >
                    ＋
                  </button>
                  <button
                    type="button"
                    data-add-asset
                    title="Add image"
                    aria-label="Add image"
                  >
                    ⇧
                  </button>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/gif,image/webp"
                    hidden
                    data-asset-input
                  />
                </div>
              ) : null}
            </div>
            <nav data-file-list aria-label="Template files"></nav>
            <div data-file-actions class="template-file-actions"></div>
          </aside>
          <div
            class="template-resizer template-resizer-x"
            data-resizer="files"
            role="separator"
            tabindex={0}
            aria-label="Resize left panel"
          />
          <main class="template-code-area">
            <div
              data-editor-tabs
              class="template-editor-tabs"
              role="tablist"
            ></div>
            <div
              data-template-editor-mount
              class="template-editor-mount"
              aria-label="Template source editor"
            ></div>
            <div data-binary-view class="template-binary-view" hidden></div>
          </main>
          <div
            class="template-resizer template-resizer-x"
            data-resizer="preview"
            role="separator"
            tabindex={0}
            aria-label="Resize right panel"
          />
          <aside
            class="template-preview-shell"
            data-panel="preview"
            aria-label="PDF preview"
          >
            <div class="template-preview-tabs" role="tablist">
              <button type="button" role="tab" aria-selected="true">Preview</button>
            </div>
            <div class="template-panel-heading template-preview-statusbar">
              <div>
                <p
                  data-template-preview-status
                  role="status"
                  aria-live="polite"
                >
                  Loading preview data…
                </p>
              </div>
              <button
                type="button"
                data-template-preview-retry
                class="btn btn-ghost btn-xs"
                hidden
              >
                Retry
              </button>
            </div>
            <div data-template-preview class="template-preview-panel"></div>
          </aside>
          <div
            class="template-resizer template-resizer-y"
            data-resizer="tools"
            role="separator"
            tabindex={0}
            aria-label="Resize bottom panel"
          />
          <section class="template-tools-panel" data-panel="tools">
            <div class="template-tool-tabs" role="tablist">
              <button type="button" data-tool-tab="problems" class="is-active">
                Problems <span data-problem-count></span>
              </button>
              <button type="button" data-tool-tab="used">
                Used fields
              </button>
              <button type="button" data-tool-tab="available">
                Available fields
              </button>
              <button type="button" data-tool-tab="preview-data">
                Preview data
              </button>
              <button type="button" data-tool-tab="info">
                Info & history
              </button>
            </div>
            <div class="template-tool-content">
              <div data-tool-view="problems">
                <p data-problems-empty>No template problems detected.</p>
                <div data-problems></div>
              </div>
              <div data-tool-view="used" hidden>
                <div data-used-fields></div>
              </div>
              <div data-tool-view="available" hidden>
                <div class="template-dynamic-fields" data-dynamic-available-fields></div>
                <details class="template-generic-fields">
                  <summary>Collection helpers</summary>
                  <AvailableFields engine={engine} />
                </details>
              </div>
              <div data-tool-view="preview-data" hidden>
                <PreviewDataEditor />
              </div>
              <div data-tool-view="info" hidden>
                <p>
                  Every save creates an immutable package revision. The preview
                  uses preview-only data selected in this browser session.
                </p>
                {engine === "gotenberg-html" ? (
                  <p>
                    Reuse local markup with{" "}
                    <code>{`{% render 'partials/header.liquid', invoice: invoice %}`}</code>
                    . Partials must be package-local <code>.liquid</code> files
                    and receive named values explicitly.
                  </p>
                ) : (
                  <p>
                    Split layouts into local TSX modules and keep images in this
                    package. The entry file must export the template as its
                    default function.
                  </p>
                )}
                {engine === "gotenberg-html" &&
                gotenbergStatus.state !== "healthy" ? (
                  <p class="template-tool-warning">
                    Preview unavailable: {gotenbergStatus.message}
                  </p>
                ) : null}
                <h3>Revision history</h3>
                <ul>
                  {revisions.map((item) => (
                    <li>
                      <span>Revision {item.revision}</span>
                      <time>{item.createdAt}</time>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
        </div>
      </form>
      <dialog class="template-shortcuts-dialog" data-shortcuts-dialog>
        <form method="dialog">
          <header><h2>Keyboard shortcuts</h2><button aria-label="Close keyboard shortcuts">×</button></header>
          <dl data-shortcuts-list></dl>
          <button class="btn btn-primary btn-sm">Close</button>
        </form>
      </dialog>
      <script type="module" src="/public/template-editor.mjs"></script>
    </section>
  );
}

function EditorMenu({ label, children }: { label: string; children: unknown }) {
  return <details class="template-editor-menu"><summary>{label}</summary><div>{children}</div></details>;
}

function MenuButton({ command, checked, children }: { command: string; checked?: boolean; children: unknown }) {
  return <button type="button" data-editor-command={command} aria-pressed={checked ? "true" : undefined}>{children}</button>;
}

function PanelToggle({ panel, label }: { panel: "files" | "tools" | "preview"; label: string }) {
  const shapes = panel === "files" ? <><rect class="template-panel-icon-fill" x="4" y="5" width="4" height="14" rx="1"/><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 4v16"/></> : panel === "tools" ? <><rect class="template-panel-icon-fill" x="4" y="14" width="16" height="5" rx="1"/><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 14h18"/></> : <><rect class="template-panel-icon-fill" x="16" y="5" width="4" height="14" rx="1"/><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M16 4v16"/></>;
  return <button type="button" class="template-icon-button" data-panel-toggle={panel} aria-pressed="true" aria-label={`Hide ${label} panel`} title={`Hide ${label} panel`}><svg viewBox="0 0 24 24" aria-hidden="true">{shapes}</svg></button>;
}

function AvailableFields({
  engine,
}: {
  engine: "gotenberg-html" | "react-pdf";
}) {
  if (engine === "react-pdf") return <ReactAvailableFields />;
  const groups = [
    {
      name: "Invoice",
      entries: [
        ["invoice.number", "{{ invoice.number }}"],
        ["invoice.dateIso", "{{ invoice.dateIso }}"],
        ["invoice.dateDisplay", "{{ invoice.dateDisplay }}"],
        [
          "invoice.dateYear / dateMonth",
          "{{ invoice.dateYear }}-{{ invoice.dateMonth }}",
        ],
        ["invoice.currency", "{{ invoice.currency }}"],
        ["invoice.notes", "{{ invoice.notes }}"],
      ],
    },
    {
      name: "Parties",
      entries: [
        ["issuer.name", "{{ issuer.name }}"],
        ["customer.name", "{{ customer.name }}"],
        ["customer.code", "{{ customer.code }}"],
        [
          "issuer/customer fields",
          "{% for field in issuer.fields %}\n  {{ field.label }}: {{ field.value }}\n{% endfor %}",
        ],
        [
          "party sections",
          "{% for field in issuer.sections.payment %}\n  {{ field.label }}: {{ field.value }}\n{% endfor %}",
        ],
      ],
    },
    {
      name: "Totals & items",
      entries: [
        ["total.display", "{{ total.display }}"],
        ["total.decimal", "{{ total.decimal }}"],
        ["total.minor", "{{ total.minor }}"],
        [
          "items",
          "{% for item in items %}\n  {{ item.name }} — {{ item.valueDisplay }}\n{% endfor %}",
        ],
      ],
    },
    {
      name: "Linked NFS-e",
      entries: [
        [
          "optional notaFiscal",
          "{% if notaFiscal %}\n  {{ notaFiscal.number }} · {{ notaFiscal.issueDateDisplay }}\n{% endif %}",
        ],
        [
          "notaFiscal public URL",
          "{% if notaFiscal %}{{ notaFiscal.publicUrl }}{% endif %}",
        ],
      ],
    },
    {
      name: "Supporting records",
      note: "Record field keys come from each configured record type. Replace reference below with a key that exists in your setup.",
      entries: [
        [
          "records",
          "{% for record in records %}\n  {{ record.typeName }} — {{ record.purpose }}\n  {% if record.field.reference %}\n    {{ record.field.reference.label }}: {{ record.field.reference.value }}\n  {% endif %}\n{% endfor %}",
        ],
      ],
    },
  ];
  return (
    <div class="template-field-groups">
      {groups.map((group) => (
        <section>
          <h3>{group.name}</h3>
          {group.note ? <p>{group.note}</p> : null}
          <div>
            {group.entries.map(([label, snippet]) => (
              <button type="button" data-insert-field={snippet}>
                <code>{label}</code>
                <span>Insert</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function PreviewDataEditor() {
  return (
    <div class="template-preview-data" data-preview-data-editor>
      <header>
        <div>
          <h3>Preview values</h3>
          <p data-preview-data-status role="status" aria-live="polite">Loading preview values…</p>
        </div>
        <div class="template-preview-data-actions">
          <button type="button" data-preview-empty-all>Empty all</button>
          <button type="button" data-preview-reset-overrides>Reset overrides</button>
          <button type="button" data-preview-restore-samples>Restore samples</button>
        </div>
      </header>
      <details class="template-preview-source-settings">
        <summary>Data sources <span data-preview-sources-summary></span></summary>
        <div class="template-preview-sources">
        <label><span>Company</span><select data-preview-source="issuerSource"><option value="settings">Settings</option><option value="sample">Sample</option><option value="empty">All empty</option></select></label>
        <label><span>Customer</span><select data-preview-source="customerSource"><option value="sample">Sample</option><option value="client">Saved customer</option><option value="empty">All empty</option></select></label>
        <label class="template-preview-client" hidden><span>Saved customer</span><select data-preview-client hidden><option>Choose a customer</option></select></label>
        <label><span>Invoice, items & records</span><select data-preview-source="invoiceSource"><option value="sample">Sample</option><option value="empty">All empty</option></select></label>
        </div>
      </details>
      <div class="template-preview-sources template-preview-filters">
        <label><span>Field group</span><select data-preview-group-filter><option value="">All fields</option><option value="invoice">Invoice</option><option value="items">Line items</option><option value="issuer">Company</option><option value="customer">Customer</option><option value="records">Supporting records</option></select></label>
        <label class="template-preview-search"><span>Find a field</span><input type="search" data-preview-field-search placeholder="Name or path" /></label>
      </div>
      <p class="template-preview-data-help">Choose a field group to edit. Custom company/customer fields used in your template appear automatically.</p>
      <section class="template-preview-items" data-preview-items>
        <header><div><h3>Line items</h3><p data-preview-items-mode>Using rows from the selected source</p></div><button type="button" data-preview-add-item>Add line item</button></header>
        <div data-preview-item-list></div>
        <p>Amounts use the invoice currency and accept decimal values, such as <code>125.50</code>.</p>
      </section>
      <details class="template-preview-custom-field">
        <summary>Add a preview-only company or customer field</summary>
        <div>
          <label><span>Party</span><select data-preview-custom-party><option value="issuer">Company</option><option value="customer">Customer</option></select></label>
          <label><span>Key</span><input data-preview-custom-key maxlength={64} placeholder="purchase_order" /></label>
          <label><span>Label</span><input data-preview-custom-label maxlength={120} placeholder="Purchase order" /></label>
          <label><span>Section</span><select data-preview-custom-section><option value="identity">Identity</option><option value="contact">Contact</option><option value="address">Address</option><option value="payment">Payment</option><option value="other">Other</option></select></label>
          <button type="button" data-preview-add-field>Add field</button>
        </div>
      </details>
      <div data-preview-data-fields class="template-preview-data-fields"></div>
    </div>
  );
}

function ReactAvailableFields() {
  const groups = [
    {
      name: "Invoice",
      entries: [
        ["invoice.number", "{document.invoice.number}"],
        ["invoice.dateDisplay", "{document.invoice.dateDisplay}"],
        ["invoice.currency", "{document.invoice.currency}"],
        ["invoice.notes", "{document.invoice.notes}"],
      ],
    },
    {
      name: "Parties",
      entries: [
        ["issuer.name", "{document.issuer.name}"],
        ["customer.name", "{document.customer.name}"],
        ["customer.code", "{document.customer.code}"],
        [
          "issuer/customer fields",
          "{document.issuer.fields.map((field) => (\n  <Text key={field.key}>{field.label}: {field.value}</Text>\n))}",
        ],
      ],
    },
    {
      name: "Totals & items",
      entries: [
        ["total.display", "{document.total.display}"],
        ["total.decimal", "{document.total.decimal}"],
        [
          "items",
          "{document.items.map((item, index) => (\n  <Text key={index}>{item.name} — {item.valueDisplay}</Text>\n))}",
        ],
      ],
    },
    {
      name: "Linked NFS-e",
      entries: [
        [
          "optional notaFiscal",
          "{document.notaFiscal ? (\n  <Text>{document.notaFiscal.number} · {document.notaFiscal.issueDateDisplay}</Text>\n) : null}",
        ],
        [
          "notaFiscal public URL",
          "{document.notaFiscal?.publicUrl ? <Text>{document.notaFiscal.publicUrl}</Text> : null}",
        ],
      ],
    },
    {
      name: "Supporting records",
      entries: [
        [
          "records",
          "{document.records.map((record, index) => (\n  <Text key={index}>{record.typeName} — {record.purpose}</Text>\n))}",
        ],
      ],
    },
  ];
  return (
    <div class="template-field-groups">
      {groups.map((group) => (
        <section>
          <h3>{group.name}</h3>
          <div>
            {group.entries.map(([label, snippet]) => (
              <button type="button" data-insert-field={snippet}>
                <code>{label}</code>
                <span>Insert</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

const defaultTemplateSource = `<!doctype html>\n<html>\n<head>\n  <meta charset="utf-8">\n  <title>Invoice {{ invoice.number }}</title>\n  <style>body { font-family: sans-serif; padding: 32px; }</style>\n</head>\n<body>\n  <h1>Invoice {{ invoice.number }}</h1>\n  <p>{{ customer.name }}</p>\n  <p>Total: {{ total.display }}</p>\n</body>\n</html>`;

const defaultReactTemplateSource = `import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 11 },
  title: { fontSize: 22, marginBottom: 18 },
  total: { marginTop: 18, fontSize: 14 },
});

export default function Template({ document }) {
  return <Document>
    <Page size="A4" style={styles.page}>
      <Text style={styles.title}>Invoice {document.invoice.number}</Text>
      <Text>{document.customer.name}</Text>
      <View style={styles.total}><Text>Total: {document.total.display}</Text></View>
    </Page>
  </Document>;
}`;
