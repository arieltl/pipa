import type { PdfTemplate, PdfTemplateRevision } from "../../db/schema.ts";
import { PageHeader } from "../../web/components/page-header.tsx";
import { Alert, type FieldErrors } from "../../web/components/forms.tsx";
import type { GotenbergStatus } from "./pdf-engine-status.ts";

export type HtmlTemplateValues = {
  name: string;
  source: string;
  packageJson?: string;
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
          <a href="/settings/pdf-templates/new" class="btn btn-primary btn-sm">
            New template
          </a>
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
                  ? "Code-defined React PDF layout"
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
  values = { name: "Untitled template", source: defaultTemplateSource },
  errors = {},
  gotenbergStatus,
}: {
  values?: HtmlTemplateValues;
  errors?: FieldErrors;
  gotenbergStatus: GotenbergStatus;
}) {
  return (
    <TemplateWorkspace
      action="/settings/pdf-templates"
      values={values}
      errors={errors}
      gotenbergStatus={gotenbergStatus}
      submitLabel="Create template"
      templateKey="new"
      revision={0}
      revisions={[]}
      editable
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
  if (template.engine === "react-pdf")
    return (
      <div>
        <PageHeader
          title={template.name}
          description={`Code-defined React PDF layout · revision ${revision.revision}`}
          actions={
            <a href="/settings/pdf-templates" class="btn btn-ghost btn-sm">
              Back to templates
            </a>
          }
        />
        <div class="app-card rounded-xl p-6">
          <h2 class="font-semibold">Application layout</h2>
          <p class="mt-2 max-w-2xl text-sm text-base-content/65">
            This layout ships with Pipa and is implemented in application code.
            It can be selected and revision-pinned, but its source is not
            editable in this workspace.
          </p>
          <a
            href={`/settings/pdf-templates/${template.id}/sample.pdf`}
            class="btn btn-primary btn-sm mt-5"
          >
            Open sample PDF
          </a>
        </div>
      </div>
    );
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
}) {
  const packageJson =
    values.packageJson ??
    JSON.stringify({
      version: 1,
      entry: "index.html",
      files: [{ path: "index.html", content: values.source, encoding: "utf8" }],
    });
  return (
    <section
      data-template-editor
      data-template-key={templateKey}
      data-template-editable={editable ? "true" : "false"}
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
          <a
            href="/settings/pdf-templates"
            class="template-icon-button"
            aria-label="Back to template library"
            title="Template library"
          >
            ←
          </a>
          <div class="template-title-field">
            <input
              name="name"
              value={values.name}
              maxlength={120}
              readonly={!editable}
              aria-label="Template name"
            />
            <span>Revision {revision || "draft"}</span>
          </div>
          <span data-template-dirty class="template-save-state" hidden>
            Unsaved
          </span>
          <span data-template-saved class="template-save-state">
            Saved
          </span>
          <div class="template-toolbar-spacer" />
          <button
            type="button"
            class="btn btn-ghost btn-xs"
            data-panel-toggle="files"
            aria-pressed="true"
          >
            Files
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-xs"
            data-panel-toggle="tools"
            aria-pressed="true"
          >
            Tools
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-xs"
            data-panel-toggle="preview"
            aria-pressed="true"
          >
            Preview
          </button>
          {templateId ? (
            <a
              href={`/settings/pdf-templates/${templateId}/source`}
              class="btn btn-ghost btn-xs"
            >
              Export
            </a>
          ) : null}
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
            aria-label="Resize files panel"
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
            aria-label="Resize preview panel"
          />
          <aside
            class="template-preview-shell"
            data-panel="preview"
            aria-label="PDF preview"
          >
            <div class="template-panel-heading">
              <div>
                <strong>Preview</strong>
                <p
                  data-template-preview-status
                  role="status"
                  aria-live="polite"
                >
                  Preview uses fictional data
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
            aria-label="Resize tools panel"
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
                <AvailableFields />
              </div>
              <div data-tool-view="info" hidden>
                <p>
                  Every save creates an immutable package revision. The preview
                  uses fictional invoice data.
                </p>
                <p>
                  Reuse local markup with{" "}
                  <code>{`{% render 'partials/header.liquid', invoice: invoice %}`}</code>
                  . Partials must be package-local <code>.liquid</code> files
                  and receive named values explicitly.
                </p>
                {gotenbergStatus.state !== "healthy" ? (
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
      <script type="module" src="/public/template-editor.mjs"></script>
    </section>
  );
}

function AvailableFields() {
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

const defaultTemplateSource = `<!doctype html>\n<html>\n<head>\n  <meta charset="utf-8">\n  <title>Invoice {{ invoice.number }}</title>\n  <style>body { font-family: sans-serif; padding: 32px; }</style>\n</head>\n<body>\n  <h1>Invoice {{ invoice.number }}</h1>\n  <p>{{ customer.name }}</p>\n  <p>Total: {{ total.display }}</p>\n</body>\n</html>`;
