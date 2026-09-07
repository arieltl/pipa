import type { ClientInvoiceRecordType } from "../../../db/schema.ts";
import { parseRecordDefinitions, type RecordAttachmentDefinition, type RecordFieldDefinition } from "../../../domain/invoice-records.ts";
import { Alert, Field, inputClass, selectClass, type FieldErrors } from "../../../web/components/forms.tsx";

export type RecordTypeValues = { name: string; key: string; purpose: "nfse" | "custom"; allowMultiple: boolean; fields: RecordFieldDefinition[]; attachments: RecordAttachmentDefinition[] };
const emptyValues: RecordTypeValues = { name: "", key: "", purpose: "custom", allowMultiple: false, fields: [], attachments: [] };

export function RecordTypesSection({ clientId, recordTypes, editor, errors = {}, submittedValues, saved }: { clientId: number; recordTypes: ClientInvoiceRecordType[]; editor?: "new" | number; errors?: FieldErrors; submittedValues?: RecordTypeValues; saved?: string }) {
  const active = recordTypes.filter((item) => !item.archivedAt);
  const archived = recordTypes.filter((item) => item.archivedAt);
  return <section id="client-record-types" class="mt-6" x-data={`{ newOpen: ${editor === "new"} }`}>
    <div class="mb-3 flex flex-wrap items-end justify-between gap-3">
      <div><h2 class="text-lg font-semibold">Invoice records</h2><p class="text-sm text-base-content/55">Define reusable information and attachment groups for this client.</p></div>
      <button type="button" class="btn btn-primary btn-sm" x-on:click="newOpen = true">Add record type</button>
    </div>
    {saved ? <Alert kind="success" message={saved} /> : null}
    <div class="grid gap-4">
      {active.map((item) => <RecordTypeCard clientId={clientId} item={item} open={editor === item.id} values={editor === item.id && submittedValues ? submittedValues : valuesFromRow(item)} errors={editor === item.id ? errors : {}} />)}
      {!active.length ? <div class="app-card rounded-xl p-5 text-sm text-base-content/55">No record types yet. Add NFS-e, purchase order, timesheet, or another supporting record.</div> : null}
      <div class="app-card rounded-xl p-5"><button type="button" class="flex w-full justify-between font-semibold" x-on:click="newOpen = !newOpen"><span>New record type</span><span x-text="newOpen ? '−' : '+'">+</span></button><div x-show="newOpen" class="mt-4" style={editor === "new" ? "" : "display:none"}><RecordTypeForm action={`/clients/${clientId}/record-types`} values={editor === "new" && submittedValues ? submittedValues : emptyValues} errors={editor === "new" ? errors : {}} submitLabel="Create record type" /></div></div>
      {archived.length ? <details class="app-card rounded-xl p-5"><summary class="cursor-pointer text-sm font-medium">Archived record types ({archived.length})</summary>{archived.map((item) => <div class="mt-2 flex justify-between border-t border-base-300/50 pt-2 text-sm"><span>{item.name}</span><code>{item.key}</code></div>)}</details> : null}
    </div>
  </section>;
}

function RecordTypeCard({ clientId, item, open, values, errors }: { clientId: number; item: ClientInvoiceRecordType; open: boolean; values: RecordTypeValues; errors: FieldErrors }) {
  return <article class="app-card rounded-xl p-5" x-data={`{ open: ${open} }`}><div class="flex items-start justify-between gap-3"><button type="button" class="text-left" x-on:click="open = !open"><span class="block font-semibold">{item.name}</span><span class="mt-1 flex gap-2 text-xs text-base-content/50"><code>{item.key}</code><span class="badge badge-outline badge-sm">{item.purpose === "nfse" ? "NFS-e" : "Custom"}</span></span></button><div class="flex gap-2"><button type="button" class="btn btn-ghost btn-sm" x-on:click="open = !open">Edit</button><button type="button" class="btn btn-ghost btn-sm text-error" hx-delete={`/clients/${clientId}/record-types/${item.id}`} hx-target="#client-record-types" hx-swap="outerHTML" hx-confirm={`Archive “${item.name}”? Existing invoice records and files will be kept.`}>Archive</button></div></div><div x-show="open" class="mt-4" style={open ? "" : "display:none"}><RecordTypeForm action={`/clients/${clientId}/record-types/${item.id}`} values={values} errors={errors} submitLabel="Save record type" lockKey /></div></article>;
}

function RecordTypeForm({ action, values, errors, submitLabel, lockKey }: { action: string; values: RecordTypeValues; errors: FieldErrors; submitLabel: string; lockKey?: boolean }) {
  const state = JSON.stringify({ fields: values.fields, attachments: values.attachments });
  return <form hx-post={action} hx-target="#client-record-types" hx-swap="outerHTML" class="grid gap-4 sm:grid-cols-2" x-data={state}>
    {errors._form ? <div class="sm:col-span-2"><Alert kind="error" message={errors._form} /></div> : null}
    <Field label="Name" name="name" required error={errors.name}><input name="name" value={values.name} class={inputClass(errors.name)} /></Field>
    <Field label="Stable key" name="key" required error={errors.key} hint="Lowercase letters, numbers, and underscores."><input name="key" value={values.key} readonly={lockKey} class={inputClass(errors.key)} /></Field>
    <Field label="Purpose" name="purpose" hint="Purpose controls presets and placement only." error={errors.purpose}><select name="purpose" class={selectClass(errors.purpose)}><option value="custom" selected={values.purpose === "custom"}>Custom</option><option value="nfse" selected={values.purpose === "nfse"}>NFS-e</option></select></Field>
    <label class="flex items-center gap-3 self-center"><input type="checkbox" name="allowMultiple" class="checkbox checkbox-sm" checked={values.allowMultiple} /><span class="text-sm">Allow multiple records per invoice</span></label>
    <input type="hidden" name="fieldDefinitionsJson" x-bind:value="JSON.stringify(fields)" />
    <input type="hidden" name="attachmentDefinitionsJson" x-bind:value="JSON.stringify(attachments)" />
    <div class="sm:col-span-2 rounded-lg border border-base-300 p-4"><div class="mb-3 flex justify-between"><div><h3 class="font-medium">Information fields</h3><p class="text-xs text-base-content/50">The saved definition is snapshotted with every record.</p></div><button type="button" class="btn btn-ghost btn-xs" x-on:click="fields.push({key:'',label:'',kind:'text',required:false,choices:[]})">Add field</button></div><template x-for="(field, index) in fields" x-bind:key="index"><div class="mb-2 grid gap-2 md:grid-cols-[1fr_1.3fr_1fr_auto_auto]"><input class="input input-sm w-full" placeholder="key" x-model="field.key"/><input class="input input-sm w-full" placeholder="Label" x-model="field.label"/><select class="select select-sm w-full" x-model="field.kind"><option>text</option><option>multiline</option><option>date</option><option>url</option><option>number</option><option>boolean</option><option>select</option></select><label class="flex items-center gap-1 text-xs"><input type="checkbox" class="checkbox checkbox-xs" x-model="field.required"/> Required</label><button type="button" class="btn btn-ghost btn-xs text-error" x-on:click="fields.splice(index,1)">×</button></div></template><p class="text-xs text-error">{errors.fieldDefinitionsJson}</p></div>
    <div class="sm:col-span-2 rounded-lg border border-base-300 p-4"><div class="mb-3 flex justify-between"><div><h3 class="font-medium">Attachments</h3><p class="text-xs text-base-content/50">Accepted types are comma-separated MIME types.</p></div><button type="button" class="btn btn-ghost btn-xs" x-on:click="attachments.push({key:'',label:'',acceptedTypes:[],maximumCount:1,required:false})">Add attachment</button></div><template x-for="(attachment, index) in attachments" x-bind:key="index"><div class="mb-2 grid gap-2 md:grid-cols-[1fr_1.2fr_1.5fr_5rem_auto]"><input class="input input-sm w-full" placeholder="key" x-model="attachment.key"/><input class="input input-sm w-full" placeholder="Label" x-model="attachment.label"/><input class="input input-sm w-full" placeholder="application/pdf" x-bind:value="attachment.acceptedTypes.join(', ')" x-on:input="attachment.acceptedTypes=$event.target.value.split(',').map(function(v){return v.trim()}).filter(Boolean)"/><input type="number" min="1" max="20" class="input input-sm w-full" x-bind:value="attachment.maximumCount" x-on:input="attachment.maximumCount=Number($event.target.value)"/><button type="button" class="btn btn-ghost btn-xs text-error" x-on:click="attachments.splice(index,1)">×</button></div></template><p class="text-xs text-error">{errors.attachmentDefinitionsJson}</p></div>
    <div class="sm:col-span-2 flex justify-end"><button type="submit" class="btn btn-primary btn-sm">{submitLabel}</button></div>
  </form>;
}

function valuesFromRow(row: ClientInvoiceRecordType): RecordTypeValues { const parsed = parseRecordDefinitions(row.fieldDefinitionsJson, row.attachmentDefinitionsJson); return { name: row.name, key: row.key, purpose: row.purpose === "nfse" ? "nfse" : "custom", allowMultiple: row.allowMultiple, fields: parsed.fields, attachments: parsed.attachments }; }
