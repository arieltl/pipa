import type { ClientInvoiceRecordType } from "../../../db/schema.ts";
import { parseRecordDefinitions, type RecordFieldDefinition } from "../../../domain/invoice-records.ts";
import { inputClass, selectClass, textareaClass } from "../../../web/components/forms.tsx";
import type { InvoiceRecordView } from "../invoice-records.instances.ts";

export function InvoiceRecordsSection({ invoiceId, recordTypes, records, error, saved, submittedRecord }: { invoiceId: number; recordTypes: ClientInvoiceRecordType[]; records: InvoiceRecordView[]; error?: string; saved?: string; submittedRecord?: { recordId: number; values: Record<string, string | boolean> } }) {
  const addableTypes = recordTypes.filter((type) => type.allowMultiple || !records.some((record) => record.recordTypeId === type.id));
  return <section id="invoice-records" class="grid gap-3">
    <div class="flex items-center justify-between"><div><h2 class="text-sm font-semibold uppercase tracking-wide text-base-content/55">Supporting records</h2><p class="mt-1 text-xs text-base-content/45">Metadata and files configured for this client.</p></div></div>
    {error ? <div class="alert alert-error text-sm">{error}</div> : null}{saved ? <div class="alert alert-success text-sm">{saved}</div> : null}
    {records.map((record) => <RecordCard invoiceId={invoiceId} record={record} submittedValues={submittedRecord?.recordId === record.id ? submittedRecord.values : undefined} />)}
    {addableTypes.length ? <details class="app-card rounded-lg p-4"><summary class="cursor-pointer text-sm font-medium">Add supporting record</summary><form class="mt-3 flex gap-2" hx-post={`/invoices/${invoiceId}/records`} hx-target="#invoice-records" hx-swap="outerHTML"><select name="recordTypeId" class="select select-sm min-w-0 flex-1" required><option value="">Choose type…</option>{addableTypes.map((type) => <option value={type.id}>{type.name}</option>)}</select><button class="btn btn-primary btn-sm">Add</button></form></details> : !recordTypes.length ? <div class="app-card rounded-lg p-4 text-xs text-base-content/50">No record types configured. Add them in client settings.</div> : null}
  </section>;
}

function RecordCard({ invoiceId, record, submittedValues }: { invoiceId: number; record: InvoiceRecordView; submittedValues?: Record<string, string | boolean> }) {
  const requiredAttachments = record.definitions.attachments.filter((definition) => definition.required && !record.attachments.some((item) => item.attachment.definitionKey === definition.key && !item.file.supersededByFileId));
  return <article class="app-card rounded-lg p-4"><div class="mb-3 flex items-center gap-2"><h3 class="font-semibold">{record.recordTypeName}</h3>{record.purpose === "nfse" ? <span class="badge badge-outline badge-sm">NFS-e</span> : null}</div>
    {requiredAttachments.length ? <div class="alert alert-warning mb-3 text-xs">Incomplete: upload {requiredAttachments.map((definition) => definition.label).join(", ")}.</div> : null}
    <form class="grid gap-3" hx-post={`/invoices/${invoiceId}/records/${record.id}`} hx-target="#invoice-records" hx-swap="outerHTML">
      {record.definitions.fields.map((definition) => <RecordField definition={definition} value={submittedValues?.[definition.key] ?? record.values[definition.key]} />)}
      <div class="flex justify-end"><button class="btn btn-primary btn-sm">Save information</button></div>
    </form>
    {record.definitions.attachments.length ? <div class="mt-4 border-t border-base-300/60 pt-3"><h4 class="mb-2 text-xs font-semibold uppercase tracking-wide text-base-content/50">Attachments</h4>{record.definitions.attachments.map((definition) => { const attached = record.attachments.filter((item) => item.attachment.definitionKey === definition.key && !item.file.supersededByFileId); const canUpload = definition.maximumCount === 1 || attached.length < definition.maximumCount; return <div class="mb-3"><div class="mb-1 flex justify-between text-xs"><span>{definition.label}{definition.required ? " *" : ""}</span><span class="text-base-content/45">{attached.length}/{definition.maximumCount}</span></div>{attached.map(({ file }) => <a class="link mr-3 text-xs" href={`/invoices/${invoiceId}/records/files/${file.id}`}>{file.originalFilename ?? "Download"}</a>)}{canUpload ? <form class="mt-2 flex gap-2" enctype="multipart/form-data" hx-post={`/invoices/${invoiceId}/records/${record.id}/attachments/${definition.key}`} hx-target="#invoice-records" hx-swap="outerHTML"><input type="file" name="file" class="file-input file-input-sm min-w-0 flex-1" accept={definition.acceptedTypes.join(",")} required/><button class="btn btn-ghost btn-sm">{definition.maximumCount === 1 && attached.length ? "Replace" : "Upload"}</button></form> : null}</div>; })}</div> : null}
  </article>;
}

function RecordField({ definition, value }: { definition: RecordFieldDefinition; value: string | boolean | undefined }) {
  const name = `value_${definition.key}`; const stringValue = typeof value === "string" ? value : "";
  return <label class="form-control"><span class="mb-1 text-xs font-medium">{definition.label}{definition.required ? " *" : ""}</span>{definition.kind === "multiline" ? <textarea name={name} class={textareaClass()} rows={3}>{stringValue}</textarea> : definition.kind === "boolean" ? <input type="checkbox" name={name} class="checkbox checkbox-sm" checked={value === true} /> : definition.kind === "select" ? <select name={name} class={selectClass()} required={definition.required}><option value="">Choose…</option>{definition.choices.map((choice) => <option selected={choice === value}>{choice}</option>)}</select> : <input name={name} type={definition.kind === "url" ? "url" : definition.kind} value={stringValue} class={inputClass()} required={definition.required} />}</label>;
}
