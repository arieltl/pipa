import type { PdfTemplate, PdfTemplateRevision } from "../../db/schema.ts";
import { PageHeader } from "../../web/components/page-header.tsx";
import {
  Alert,
  Field,
  inputClass,
  textareaClass,
  type FieldErrors,
} from "../../web/components/forms.tsx";
import type { GotenbergStatus } from "./pdf-engine-status.ts";

export type HtmlTemplateValues = { name: string; source: string };

export function PdfTemplatesPage({
  templates,
  engine,
  values = { name: "", source: "" },
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
    <div>
      <PageHeader
        title="PDF templates"
        description="Reusable, revisioned document layouts. Existing invoices keep their selected revision."
      />
      <GotenbergStatusCard status={gotenbergStatus} />
      <div class="mb-5 flex flex-wrap gap-2">
        <FilterLink href="/settings/pdf-templates" label="All" active={!engine} />
        <FilterLink href="/settings/pdf-templates?engine=react-pdf" label="React PDF" active={engine === "react-pdf"} />
        <FilterLink href="/settings/pdf-templates?engine=gotenberg-html" label="HTML / Gotenberg" active={engine === "gotenberg-html"} />
      </div>
      <div class="grid gap-4 md:grid-cols-2">
        {templates.map((template) => (
          <a href={`/settings/pdf-templates/${template.id}`} class="app-card rounded-xl p-5 transition hover:border-primary/40">
            <div class="flex items-start justify-between gap-3">
              <div>
                <h2 class="font-semibold">{template.name}</h2>
                <p class="mt-1 text-sm text-base-content/50">
                  {template.sourceKind === "builtin" ? "Built in" : "User template"}
                  {` · revision ${revisionNumbers[template.id] ?? "—"}`}
                </p>
              </div>
              <span class="badge badge-outline badge-sm">
                {template.engine === "react-pdf" ? "React PDF" : "HTML"}
              </span>
              {template.engine === "gotenberg-html" && gotenbergStatus.state !== "healthy" ? (
                <span class="badge badge-warning badge-sm">Unavailable</span>
              ) : null}
            </div>
          </a>
        ))}
      </div>

      <details class="app-card mt-6 rounded-xl p-5" open={Boolean(errors._form || errors.name || errors.source)}>
        <summary class="cursor-pointer font-semibold">New HTML template</summary>
        <div class="mt-4">
          <HtmlTemplateForm action="/settings/pdf-templates" values={values} errors={errors} submitLabel="Create template" />
        </div>
      </details>
      <details class="app-card mt-4 rounded-xl p-5">
        <summary class="cursor-pointer font-semibold">Import HTML template</summary>
        <form method="post" action="/settings/pdf-templates/import" enctype="multipart/form-data" class="mt-4 flex flex-wrap items-end gap-3">
          <Field label="Template file" name="file" required hint="Complete .html or .liquid document, maximum 20 KB.">
            <input name="file" type="file" accept=".html,.htm,.liquid,text/html,text/plain" class="file-input file-input-bordered flex-1" required />
          </Field>
          <button type="submit" class="btn btn-primary">Import</button>
        </form>
      </details>
    </div>
  );
}

export function GotenbergStatusCard({ status }: { status: GotenbergStatus }) {
  const healthy = status.state === "healthy";
  const badgeClass = healthy
    ? "badge-success"
    : status.state === "unconfigured"
      ? "badge-ghost"
      : "badge-warning";
  return (
    <div id="gotenberg-status" class="app-card mb-5 rounded-xl p-4">
      <div class="flex flex-wrap items-center gap-3">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <h2 class="font-semibold">HTML PDF engine</h2>
            <span class={`badge badge-sm ${badgeClass}`}>{status.state}</span>
          </div>
          <p class="mt-1 text-sm text-base-content/55">{status.message}</p>
        </div>
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          hx-post="/settings/pdf-templates/engine-check"
          hx-target="#gotenberg-status"
          hx-swap="outerHTML"
        >
          Check connection
        </button>
      </div>
    </div>
  );
}

function FilterLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  return <a href={href} class={`btn btn-sm ${active ? "btn-primary" : "btn-ghost"}`}>{label}</a>;
}

export function PdfTemplateDetailPage({
  template,
  revision,
  revisions,
  values,
  errors = {},
  renderedSample,
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
  const editable = template.engine === "gotenberg-html" && template.sourceKind !== "builtin";
  const previewAvailable =
    template.engine === "react-pdf" || gotenbergStatus.state === "healthy";
  return (
    <div>
      <PageHeader
        title={template.name}
        description={`${template.engine === "react-pdf" ? "React PDF" : "HTML / Gotenberg"} · revision ${revision.revision}`}
        actions={
          <div class="flex gap-2">
            {previewAvailable ? (
              <a href={`/settings/pdf-templates/${template.id}/sample.pdf`} class="btn btn-primary btn-sm">
                Sample PDF
              </a>
            ) : (
              <button type="button" class="btn btn-primary btn-sm" disabled title={gotenbergStatus.message}>
                Sample PDF unavailable
              </button>
            )}
            {template.engine === "gotenberg-html" ? (
              <a href={`/settings/pdf-templates/${template.id}/source`} class="btn btn-ghost btn-sm">
                Export source
              </a>
            ) : null}
            <a href="/settings/pdf-templates" class="btn btn-ghost btn-sm">Back to templates</a>
          </div>
        }
      />
      {template.engine === "gotenberg-html" ? (
        <div class={`alert mb-5 py-2 text-sm ${gotenbergStatus.state === "healthy" ? "alert-success" : "alert-warning"}`}>
          <span>{gotenbergStatus.message}</span>
        </div>
      ) : null}
      {template.engine === "react-pdf" ? (
        <div class="app-card rounded-xl p-5 text-sm text-base-content/60">
          This layout is implemented in application code. It is reusable and revision-pinned, but has no editable Liquid source.
        </div>
      ) : editable ? (
        <div class="app-card rounded-xl p-5">
          <HtmlTemplateForm
            action={`/settings/pdf-templates/${template.id}/revisions`}
            values={values}
            errors={errors}
            submitLabel="Save new revision"
          />
        </div>
      ) : (
        <div class="app-card rounded-xl p-5">
          <Alert kind="success" message="Built-in templates are immutable. Duplicate this template to customize it." />
          <form method="post" action={`/settings/pdf-templates/${template.id}/duplicate`} class="mb-4 flex justify-end">
            <button type="submit" class="btn btn-primary btn-sm">Duplicate to edit</button>
          </form>
          <pre class="max-h-[36rem] overflow-auto rounded-lg bg-base-200 p-4 text-xs"><code>{revision.source}</code></pre>
        </div>
      )}

      {renderedSample ? (
        <details class="app-card mt-5 rounded-xl p-5">
          <summary class="cursor-pointer font-semibold">Rendered sample HTML</summary>
          <pre class="mt-4 max-h-96 overflow-auto rounded-lg bg-base-200 p-4 text-xs"><code>{renderedSample}</code></pre>
        </details>
      ) : null}

      <section class="app-card mt-5 rounded-xl p-5">
        <h2 class="font-semibold">Revision history</h2>
        <ul class="mt-3 divide-y divide-base-300/60 text-sm">
          {revisions.map((item) => (
            <li class="flex justify-between gap-3 py-2">
              <span>Revision {item.revision}</span>
              <span class="text-base-content/50">{item.createdAt}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function HtmlTemplateForm({ action, values, errors, submitLabel }: { action: string; values: HtmlTemplateValues; errors: FieldErrors; submitLabel: string }) {
  return (
    <form method="post" action={action} class="grid gap-4">
      {errors._form ? <Alert kind="error" message={errors._form} /> : null}
      <Field label="Name" name="name" required error={errors.name}>
        <input name="name" value={values.name} maxlength={120} class={inputClass(errors.name)} />
      </Field>
      <Field
        label="Complete HTML + Liquid source"
        name="source"
        required
        hint="Use the shared invoice, customer, issuer, items, total, and notaFiscal model. Values are HTML-escaped by default."
        error={errors.source}
      >
        <textarea name="source" rows={22} maxlength={20000} class={`${textareaClass(errors.source)} font-mono text-xs`}>{values.source}</textarea>
      </Field>
      <div class="flex justify-end"><button type="submit" class="btn btn-primary">{submitLabel}</button></div>
    </form>
  );
}
