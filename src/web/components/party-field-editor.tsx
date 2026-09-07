import { PARTY_FIELD_DEFINITIONS, PARTY_FIELD_SECTIONS, PARTY_FIELD_SETS, type PartyField } from "../../domain/party-fields/index.ts";
import { Alert } from "./forms.tsx";

const sectionLabels: Record<string, string> = { identity: "Identity", contact: "Contact", address: "Address", payment: "Payment", other: "Other" };

export function PartyFieldEditor({ fields, error }: { fields: PartyField[]; error?: string }) {
  const payload = encodeURIComponent(JSON.stringify({ fields, definitions: PARTY_FIELD_DEFINITIONS, sets: PARTY_FIELD_SETS }));
  return (
    <div class="space-y-4" x-data={`partyFieldEditor(${JSON.stringify(payload)})`}>
      <input type="hidden" name="partyFields" x-bind:value="serialized()" />
      <div class="flex flex-wrap items-end justify-between gap-3 px-1">
        <div><h2 class="text-lg font-semibold">Document fields</h2><p class="text-sm text-base-content/55">Add only the sections and fields needed for this party.</p></div>

      </div>
      {error ? <Alert kind="error" message={error} /> : null}
      <nav class="field-category-nav" aria-label="Field categories">{PARTY_FIELD_SECTIONS.map(section => <button type="button" x-on:click={`activeSection = '${section}'`} x-bind:aria-current={`activeSection === '${section}' ? 'page' : null`}><span>{sectionLabels[section]}</span><span class="field-count" x-text={`fieldsFor('${section}').length`}>0</span></button>)}</nav>
      <details class="field-presets"><summary>Quick setup · Add a field preset</summary><div class="flex flex-wrap gap-2 py-3">{Object.keys(PARTY_FIELD_SETS).map(key => <button type="button" class="btn btn-ghost btn-sm" x-on:click={`selectedSet = '${key}'; applySelectedSet()`}>{humanize(key)}</button>)}</div></details>
      <div x-show="pickerOpen" x-cloak class="field-picker-overlay" {...{"x-on:keydown.escape": "pickerOpen = false"}} x-on:click="if ($event.target === $el) pickerOpen = false">
        <div role="dialog" aria-modal="true" aria-label="Add a document field" class="field-picker">
          <div class="flex items-center gap-3 border-b border-base-300 p-4"><input x-ref="fieldSearch" x-model="search" type="search" class="field-picker-search" placeholder="Search fields across all categories…" aria-label="Search fields"/><button type="button" class="btn btn-ghost btn-xs" x-on:click="pickerOpen = false">Close</button></div>
          <div class="field-picker-results"><p class="p-3 text-xs uppercase text-base-content/40" x-text="search ? 'Search results' : activeSection + ' fields'"></p><template x-for="definition in matchingDefinitions()" x-bind:key="definition.key"><button type="button" class="field-picker-result" x-on:click="chooseField(definition.key)"><span><span class="block font-medium" x-text="definition.defaultLabel"></span><span class="text-xs text-base-content/40" x-text="definition.section"></span></span><span>+</span></button></template><p x-show="matchingDefinitions().length === 0" class="p-4 text-sm text-base-content/50">No matches. Create your own field below.</p></div>
          <button type="button" class="field-picker-custom" x-show="!namingCustom" x-on:click="startCustom()">+ Create a custom field</button>
          <div x-show="namingCustom" x-cloak class="border-t border-base-300 p-4">
            <label for="custom-field-name" class="mb-2 block text-sm font-medium">Field name</label>
            <input id="custom-field-name" x-ref="customName" x-model="customName" maxlength={120} class="input w-full" placeholder="e.g. Purchase order reference" {...{"x-on:keydown.enter.prevent": "confirmCustom()"}} />
            <p class="mt-2 text-xs text-base-content/50">This label will appear on the field. You can rename it later.</p>
            <div class="mt-4 flex justify-end gap-2"><button type="button" class="btn btn-ghost btn-sm" x-on:click="namingCustom = false">Cancel</button><button type="button" class="btn btn-primary btn-sm" x-bind:disabled="!customName.trim()" x-on:click="confirmCustom()">Add custom field</button></div>
          </div>
        </div>
      </div>

      {PARTY_FIELD_SECTIONS.map((section) => (
        <template x-if={`activeSection === '${section}'`}>
        <section class="app-card lift-enter rounded-lg p-5">
          <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div><h3 class="font-semibold">{sectionLabels[section]}</h3><p class="text-xs text-base-content/50" x-text={`sectionHelp('${section}')`}></p></div>
            <button type="button" class="btn btn-primary btn-sm" x-on:click="openPicker()">+ Add field</button>
          </div>
          <div class="divide-y divide-base-300" x-show={`fieldsFor('${section}').length`}>
            <template x-for={`field in fieldsFor('${section}')`} x-bind:key="field.key">
              <div class="party-field-row py-3 first:pt-0 last:pb-0" x-data="{ options: false }">
                <div class="flex items-center justify-between"><span class="text-sm font-medium" x-text="field.label"></span><button type="button" class="btn btn-ghost btn-xs" x-on:click="options = !options" x-bind:aria-label="'Settings for ' + field.label">•••</button></div><div x-show="options"><label class="mb-1 block text-xs text-base-content/50">Label</label><input class="input input-sm w-full" type="text" maxlength={120} x-model="field.label" required /></div>
                <div><label class="mb-1 block text-xs text-base-content/50">Value</label><template x-if="inputKind(field) === 'multiline'"><textarea class="textarea textarea-sm w-full" rows={2} maxlength={4000} x-model="field.value"></textarea></template><template x-if="inputKind(field) !== 'multiline'"><input class="input input-sm w-full" x-bind:type="htmlInputType(field)" maxlength={4000} x-model="field.value" /></template></div>
                <div x-show="options" class="flex items-end pb-1"><label class="flex cursor-pointer items-center gap-2 text-xs text-base-content/70"><input type="checkbox" class="checkbox checkbox-sm" x-bind:checked="field.visibility === 'internal'" x-on:change="field.visibility = $event.target.checked ? 'internal' : 'document'" /><span>Hide from invoices</span></label></div>
                <div x-show="options" class="flex items-end justify-end gap-1 pb-0.5"><button type="button" class="btn btn-square btn-sm btn-ghost" title="Move up" x-on:click="move(field, -1)">↑</button><button type="button" class="btn btn-square btn-sm btn-ghost" title="Move down" x-on:click="move(field, 1)">↓</button><button type="button" class="btn btn-square btn-sm btn-ghost text-error" title="Remove field" x-on:click="remove(field)">×</button></div>
                <details class="party-field-options" x-show="field.definitionKey === null"><summary class="cursor-pointer text-xs text-base-content/50">Custom field options</summary><div class="mt-2 grid gap-2 sm:grid-cols-2"><label class="text-xs">Key <input class="input input-xs mt-1 w-full font-mono" x-model="field.key" pattern="[a-z][a-z0-9_]*" maxlength={64} /></label><label class="text-xs">Section <select class="select select-xs mt-1 w-full" x-model="field.section" x-on:change="showSection(field.section); normalizePositions()">{PARTY_FIELD_SECTIONS.map((s) => <option value={s}>{sectionLabels[s]}</option>)}</select></label></div></details>
              </div>
            </template>
          </div>
          <p class="rounded-md border border-dashed border-base-300 p-4 text-center text-sm text-base-content/45" x-show={`fieldsFor('${section}').length === 0`}>No fields yet. Add the details this client needs.</p>
        </section>
        </template>
      ))}
      <label class="flex items-start gap-2 px-1 text-xs text-base-content/65"><input type="checkbox" name="acknowledgePartyWarnings" class="checkbox checkbox-xs" />Save anyway if a country-specific tax or bank identifier has a format warning.</label>
    </div>
  );
}

function humanize(value: string): string { return value.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase()); }
