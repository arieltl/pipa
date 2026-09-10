(() => {
  async function showPdfPreview(url, label) {
    const { openPdfPreview } = await import('/public/pdf-preview.mjs');
    return openPdfPreview(url, { label });
  }
  const canonicalJson = (item) => item === null || typeof item !== "object" ? JSON.stringify(item) : Array.isArray(item) ? `[${item.map(canonicalJson).join(",")}]` : `{${Object.keys(item).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(item[key])}`).join(",")}}`;
  async function identityDigest(value) { const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(canonicalJson(value)));return [...new Uint8Array(bytes)].map((byte)=>byte.toString(16).padStart(2,"0")).join(""); }
  function fieldLabel(field, control) {
    const label = field.querySelector(".label-text");
    return label?.textContent?.replace("*", "").trim() || control.name || "Field";
  }

  function validationMessage(control, field) {
    const label = fieldLabel(field, control);
    const validity = control.validity;

    if (validity.valueMissing) return `${label} is required.`;
    if (validity.typeMismatch && control.type === "email") {
      return "Enter a valid email address.";
    }
    if (validity.typeMismatch && control.type === "url") {
      return "Enter a valid URL, including https://.";
    }
    if (validity.patternMismatch) {
      return control.title || "Use the expected format.";
    }
    if (validity.tooLong) {
      return `${label} must be ${control.maxLength} characters or fewer.`;
    }
    return control.validationMessage;
  }

  function clientError(field) {
    let error = field.querySelector("[data-client-error]");
    if (!error) {
      error = document.createElement("p");
      error.className = "app-error mt-2 text-xs";
      error.dataset.clientError = "true";
      field.append(error);
    }
    return error;
  }

  function syncField(control) {
    const field = control.closest(".app-field");
    if (!field) return;

    const value = control.type === "checkbox" ? control.checked : control.value;
    field.classList.toggle("is-filled", Boolean(value));

    const shouldValidate =
      control.dataset.touched === "true" ||
      control.form?.dataset.submitted === "true" ||
      (Boolean(value) && !control.validity.valid);
    const hasError = shouldValidate && !control.validity.valid;
    field.classList.toggle("has-client-error", hasError);
    field.classList.toggle("is-dirty", control.dataset.dirty === "true");

    const error = field.querySelector("[data-client-error]");
    if (!hasError) {
      error?.remove();
      return;
    }

    clientError(field).textContent = validationMessage(control, field);
  }

  function formatCnpj(value) {
    const digits = value.replace(/\D/g, "").slice(0, 14);
    return digits
      .replace(/^(\d{2})(\d)/, "$1.$2")
      .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
      .replace(/\.(\d{3})(\d)/, ".$1/$2")
      .replace(/(\d{4})(\d)/, "$1-$2");
  }

  function formatMoney(value) {
    const normalized = value.replace(",", ".").replace(/[^\d.]/g, "");
    const [integer = "", ...rest] = normalized.split(".");
    const decimals = rest.join("").slice(0, 2);
    if (normalized.includes(".")) return `${integer || "0"}.${decimals}`;
    return integer;
  }

  function autoGrow(control) {
    if (!(control instanceof HTMLTextAreaElement)) return;
    control.style.height = "auto";
    control.style.height = `${control.scrollHeight}px`;
  }

  function formatControl(control) {
    if (control.dataset.format === "trim") {
      control.value = control.value.trimStart();
    }

    if (control.dataset.format === "upper") {
      const start = control.selectionStart;
      const end = control.selectionEnd;
      control.value = control.value.toUpperCase();
      if (start !== null && end !== null) control.setSelectionRange(start, end);
    }

    if (control.dataset.format === "money") {
      control.value = formatMoney(control.value);
    }

    if (control.dataset.format === "cnpj") {
      control.value = formatCnpj(control.value);
    }
  }

  document.addEventListener("alpine:init", () => {
    window.Alpine.data("enhancedForm", () => ({
      init() {
        this.$el.querySelectorAll("input, select, textarea").forEach((control) => {
          syncField(control);
          autoGrow(control);
        });
      },
    }));

    // Invoice composer: editable line items + a live total before the invoice
    // exists. The client is fixed (chosen before this page), so there is no
    // client switching here. `config` carries the initial currency and items.
    window.Alpine.data("invoiceCompose", (config) => ({
      currency: config.currency || "GBP",
      items: Array.isArray(config.items) ? config.items : [],
      numberingMode: config.numberingMode || "auto",

      get total() {
        return this.items.reduce((acc, item) => {
          const n = parseFloat(String(item.value).replace(",", "."));
          return acc + (Number.isFinite(n) ? n : 0);
        }, 0);
      },

      get formattedTotal() {
        return `${this.currency} ${this.total.toFixed(2)}`;
      },

      addItem() {
        this.items.push({ name: "", value: "", source: "other", notes: "" });
      },

      removeItem(i) {
        this.items.splice(i, 1);
      },
    }));

    window.Alpine.data("partyFieldEditor", (encoded) => {
      const config = JSON.parse(decodeURIComponent(encoded));
      return {
        fields: Array.isArray(config.fields) ? config.fields : [],
        definitions: config.definitions || {},
        sets: config.sets || {},
        selectedSet: "",
        activeSection: (config.fields || [])[0]?.section || 'identity',
        pickerOpen: false,
        search: '',
        customName: '',
        namingCustom: false,
        presetOpen: false,
        matchingDefinitions() { return Object.values(this.definitions).filter(d => !this.fields.some(f => f.key === d.key) && (this.search ? (d.defaultLabel + ' ' + d.key + ' ' + d.section).toLowerCase().includes(this.search.toLowerCase()) : d.section === this.activeSection)); },
        openPicker() { this.search = ''; this.namingCustom = false; this.customName = ''; this.pickerOpen = true; this.$nextTick(() => this.$refs.fieldSearch.focus()); },
        startCustom() { this.customName = this.search.trim().slice(0, 120); this.namingCustom = true; this.$nextTick(() => this.$refs.customName.focus()); },
        confirmCustom() { if (!this.customName.trim()) return; this.addCustom(this.activeSection, this.customName); this.pickerOpen = false; this.namingCustom = false; this.$el.closest('[data-dirty-section]')?.classList.add('is-dirty-section'); },
        chooseField(key) { this.addSuggested(key); this.activeSection = this.definitions[key].section; this.pickerOpen = false; this.$el.dispatchEvent(new Event('input', { bubbles: true })); },
        sectionToAdd: "",
        sections: Object.fromEntries(["identity", "contact", "address", "payment", "other"].map((section) => [section, (config.fields || []).some((field) => field.section === section)])),
        selectedBySection: { identity: "", contact: "", address: "", payment: "", other: "" },
        fieldsFor(section) { return this.fields.filter((field) => field.section === section).sort((a, b) => a.position - b.position); },
        sectionVisible(section) { return this.sections[section] === true; },
        showSection(section) { this.sections[section] = true; },
        addSection() { if (!this.sectionToAdd) return; this.showSection(this.sectionToAdd); this.sectionToAdd = ""; },
        removeSection(section) { if (this.fieldsFor(section).length === 0) this.sections[section] = false; },
        sectionHelp(section) { return ({ identity: "Names, registrations, and tax identifiers.", contact: "Ways to contact this party.", address: "Postal address and country.", payment: "Banking and payment instructions.", other: "Additional document or internal details." })[section] || ""; },
        inputKind(field) { return field.definitionKey && this.definitions[field.definitionKey] ? this.definitions[field.definitionKey].inputKind : "multiline"; },
        htmlInputType(field) { const kind = this.inputKind(field); return kind === "email" ? "email" : kind === "url" ? "url" : kind === "phone" ? "tel" : "text"; },
        addSuggested(key) {
          const definition = this.definitions[key];
          if (!definition || this.fields.some((field) => field.key.toLowerCase() === definition.key.toLowerCase())) return;
          this.showSection(definition.section);
          this.fields.push({ key: definition.key, definitionKey: definition.key, label: definition.defaultLabel, value: "", section: definition.section, visibility: "document", position: this.fieldsFor(definition.section).length });
        },
        applySelectedSet() {
          for (const key of this.sets[this.selectedSet] || []) this.addSuggested(key);
          this.selectedSet = "";
        },
        addToSection(section) {
          const selected = this.selectedBySection[section];
          if (selected === "__custom") this.addCustom(section); else this.addSuggested(selected);
          this.selectedBySection[section] = "";
        },
        addCustom(section, name) {
          if (!name?.trim()) { this.openPicker(); this.startCustom(); return; }
          const label = name.trim().slice(0, 120);
          let base = label.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
          if (!/^[a-z]/.test(base)) base = 'field_' + base;
          base = base.slice(0, 56) || 'custom_field';
          let key = base, n = 2;
          while (this.fields.some(field => field.key.toLowerCase() === key)) key = `${base}_${n++}`;
          this.showSection(section);
          this.fields.push({ key, definitionKey: null, label, value: "", section, visibility: "document", position: this.fieldsFor(section).length });
        },
        remove(field) { this.fields = this.fields.filter((candidate) => candidate !== field); this.normalizePositions(); },
        move(field, delta) {
          const sectionFields = this.fieldsFor(field.section); const index = sectionFields.indexOf(field); const other = sectionFields[index + delta];
          if (!other) return; const position = field.position; field.position = other.position; other.position = position;
        },
        normalizePositions() { for (const section of ["identity", "contact", "address", "payment", "other"]) this.fieldsFor(section).forEach((field, index) => { field.position = index; }); },
        serialized() { return JSON.stringify(this.fields); },
      };
    });

    window.Alpine.data("invoiceEditSession", (encoded) => {
      const config = JSON.parse(decodeURIComponent(encoded));
      const savedByKey = Object.fromEntries(config.snapshot.generatedTexts.map((text) => [text.generatorKey, text]));
      const generatorByKey = Object.fromEntries(config.generators.map((generator) => [generator.key, generator]));
      const textKeys = [...new Set([...Object.keys(savedByKey), ...Object.keys(generatorByKey)])];
      const proposal = {
        invoice: { ...config.snapshot.invoice, notes: config.snapshot.invoice.notes || "" },
        items: config.snapshot.items.map((item) => ({ key: `id:${item.id}`, id: item.id, name: item.name, value: (item.value / 100).toFixed(2), source: item.source, notes: item.notes, removed: false })),
        generatedTexts: textKeys.map((key) => ({ key, name: savedByKey[key]?.generatorName || generatorByKey[key]?.name || key, sourceSnapshot: savedByKey[key]?.sourceSnapshot || generatorByKey[key]?.source || "", content: savedByKey[key]?.content ?? "", candidate: null, undo: null })),
        records: config.snapshot.records.filter((record) => !record.removedAt).map((record) => ({ key: `id:${record.id}`, id: record.id, name: record.recordTypeName, purpose:record.purpose, recordTypeId: record.recordTypeId, definitions: JSON.parse(record.definitionsSnapshotJson), values: structuredClone(record.values), baseValues: structuredClone(record.values), attachments: structuredClone(record.attachments || []), removed: false, files: [] })),
        legacy: { values: Object.fromEntries([["nfNumber", "nfNumber"], ["issueDate", "issueDate"], ["verificationCode", "verificationCode"], ["publicUrl", "publicUrl"], ["notes", "notes"]].map(([local, saved]) => [local, config.snapshot.legacy?.[saved] ?? null])), baseValues: Object.fromEntries([["nfNumber", "nfNumber"], ["issueDate", "issueDate"], ["verificationCode", "verificationCode"], ["publicUrl", "publicUrl"], ["notes", "notes"]].map(([local, saved]) => [local, config.snapshot.legacy?.[saved] ?? null])), files: structuredClone(config.legacyFiles || []) },
        refreshParties: false,
      };
      const comparable = (value) => JSON.stringify(value, (key, item) => ["candidate", "undo", "files"].includes(key) ? undefined : item);
      return {
        config, proposal, baseSnapshot: structuredClone(config.snapshot), baseComparable: comparable(proposal), section: "document", newRecordTypeId: String(config.snapshot.availableRecordTypes[0]?.id || ""), ready: false,
        editableDirty: false, unresolved: false, retainedDocumentProposal: null,
        editSessionId: null, baseGeneration: 1, baseRevision: config.baseRevision,
        frozen: null, frozenRebase: null, recoveryTimer: null, recoveryAttempt: 0, candidateSequence: 0, previewSequence: 0, preview: null, composing: false, saveAfterComposition: false, statusText: "Preparing secure editing session…", documentLocked: config.snapshot.invoice.status !== "draft",
        get formattedTotal() { const values = this.proposal.items.filter((item) => !item.removed).map((item) => Number(String(item.value).replace(",", "."))); return values.some((value) => !Number.isFinite(value)) ? "Unavailable—review amounts" : `${this.proposal.invoice.currency} ${values.reduce((sum,value) => sum + value,0).toFixed(2)}`; },
        async init() {
          this.editSessionId = crypto.randomUUID();
          const pending = this.pendingIdentity();
          if (pending?.operationId) { this.editSessionId = pending.editSessionId; this.unresolved = true; this.statusText = "Checking whether changes were saved…"; this.expectedIdentity=pending; await this.checkOperation(pending.operationId, pending.digest); return; }
          try {
            const result = await this.request(`/invoices/${config.invoiceId}/edit-sessions`, { editSessionId: this.editSessionId, desiredBaseRevision: this.baseRevision });
            if (result.outcome !== "ready") throw new Error(result.message || "Could not begin editing.");
            this.ready = true; this.statusText = "All changes saved";
            this.$watch("proposal", () => { if (!this.unresolved) { this.editableDirty = comparable(this.proposal) !== this.baseComparable; if(this.preview)this.preview.obsolete=true; this.statusText = this.editableDirty ? "Unsaved changes" : "All changes saved"; } }, { deep: true });
            this.bindErrorLinks();
            window.addEventListener("keydown", (event) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s" && this.$root.contains(document.activeElement)) { event.preventDefault(); if (this.editableDirty && !this.unresolved) this.save(); else this.announce(this.unresolved ? "A save is already being resolved." : "All changes are already saved."); } });
          } catch (error) { this.statusText = error.message; this.showOutcome({ outcome: "rejected", message: error.message }); }
        },
        markDirty() { this.editableDirty = comparable(this.proposal) !== this.baseComparable; if(this.preview)this.preview.obsolete=true; this.statusText = this.editableDirty ? "Unsaved changes" : "All changes saved"; },
        addItem() { if (this.unresolved || this.documentLocked) return; this.proposal.items.push({ key: `tmp:${crypto.randomUUID()}`, name: "", value: "", source: "other", notes: null, removed: false }); this.markDirty(); },
        removeItem(index) { if (this.unresolved || this.documentLocked) return; const item = this.proposal.items[index]; if (item.id) item.removed = true; else this.proposal.items.splice(index, 1); this.markDirty(); },
        addRecord() { if(this.unresolved)return;const type=config.snapshot.availableRecordTypes.find((candidate)=>String(candidate.id)===String(this.newRecordTypeId));if(!type){this.announce("Choose a supporting record type.");return;}if(!type.allowMultiple&&this.proposal.records.some((record)=>!record.removed&&record.recordTypeId===type.id)){this.announce("This supporting record type is already in use.");return;}this.proposal.records.push({key:`tmp:${crypto.randomUUID()}`,name:type.name,purpose:type.purpose,recordTypeId:type.id,recordTypeSnapshotDigest:type.digest,definitions:JSON.parse(type.definitionsSnapshotJson),values:{},baseValues:{},attachments:[],removed:false,files:[]});this.markDirty();},
        async uploadFile(entry, recordKey) { entry.state="uploading"; entry.message="Uploading…"; const body=new FormData(); body.set("uploadId",entry.uploadId); body.set("recordKey",recordKey); body.set("definitionKey",entry.definitionKey); body.set("file",entry.file); try { const response=await fetch(`/invoices/${config.invoiceId}/edit-sessions/${this.editSessionId}/staged-files`,{method:"POST",body}); const result=this.parseResponse(await response.text()); if(!response.ok||result.outcome!=="ready")throw new Error(result.message||"Upload failed."); entry.token=result.token;entry.state="ready";entry.message="Ready to save"; } catch(error) { entry.state="error";entry.message=error.message||"Upload failed."; } },
        async selectFile(record, definition, event) { if(this.unresolved)return;const file=event.target.files?.[0];if(!file)return;const entry={uploadId:crypto.randomUUID(),definitionKey:definition.key,file,state:"uploading",token:null,message:"Uploading…"};record.files.push(entry);this.markDirty();await this.uploadFile(entry,record.key); },
        async selectLegacyFile(kind,event) { if(this.unresolved)return;const file=event.target.files?.[0];if(!file)return;const entry={kind,uploadId:crypto.randomUUID(),definitionKey:kind,file,state:"uploading",token:null,message:"Uploading…"};this.proposal.legacy.files.push(entry);this.markDirty();await this.uploadFile(entry,"legacy:nfse"); },
        retryFile(entry,recordKey) { if(this.unresolved||entry.state!=="error")return; entry.uploadId=crypto.randomUUID();entry.token=null;this.markDirty();return this.uploadFile(entry,recordKey); },
        removeSelectedFile(owner,entry) { const index=owner.files.indexOf(entry);if(index>=0)owner.files.splice(index,1);this.markDirty(); },
        removeAttachment(record,saved) { if(this.unresolved)return;saved.pendingRemoval=true;this.markDirty(); },
        undoRecord(record) { record.removed=false;this.markDirty(); },
        legacyEffective(field) { const aliases={nfNumber:"number",issueDate:"issue_date",verificationCode:"verification_code",publicUrl:"public_url",notes:"notes"}; const value=this.proposal.legacy.values[field]; if(value!==null)return value === "" ? "Empty value will be shown" : value; const record=this.proposal.records.find((item)=>!item.removed&&item.purpose==="nfse"); const fallback=record?.values?.[aliases[field]]; return fallback === undefined || fallback === "" ? "No configured record fallback" : `Configured record: ${fallback}`; },
        async generateCandidate(text) { if(this.unresolved)return;const sequence=++this.candidateSequence;const inputDigest=await this.digest({key:text.key,proposal:this.proposal});try{const result=await this.request(`/invoices/${config.invoiceId}/edit-sessions/${this.editSessionId}/preview/generate`,{sequence,inputDigest,generatorKey:text.key,proposal:this.serializeChanges()});const currentDigest=await this.digest({key:text.key,proposal:this.proposal});if(!this.unresolved&&sequence===this.candidateSequence&&result.inputDigest===inputDigest&&result.sequence===sequence&&currentDigest===inputDigest)text.candidate=result.candidate;}catch(error){this.announce(error.message);}},
        replaceCandidate(text) { if(this.unresolved||text.candidate===null)return;text.undo=text.content;text.content=text.candidate;text.candidate=null;this.markDirty(); },
        compositionStart(){this.composing=true;}, compositionEnd(){this.composing=false;if(this.saveAfterComposition){this.saveAfterComposition=false;this.save();}},
        async previewPdf(){if(!this.ready||this.unresolved)return;const sequence=++this.previewSequence,proposal=this.serializeChanges(),inputDigest=await this.digest({invoiceId:config.invoiceId,sourceKind:"workspace-proposal",editSessionId:this.editSessionId,baseGeneration:this.baseGeneration,proposal});this.preview={sequence,inputDigest,obsolete:false};try{const result=await this.request(`/invoices/${config.invoiceId}/previews`,{previewId:crypto.randomUUID(),sourceKind:"workspace-proposal",editSessionId:this.editSessionId,baseGeneration:this.baseGeneration,inputDigest,proposal});if(this.preview?.sequence!==sequence||this.preview.inputDigest!==inputDigest)return;const currentDigest=await this.digest({invoiceId:config.invoiceId,sourceKind:"workspace-proposal",editSessionId:this.editSessionId,baseGeneration:this.baseGeneration,proposal:this.serializeChanges()});if(currentDigest!==inputDigest){this.preview.obsolete=true;this.announce("This preview is obsolete; generate another after your edits.");return;}if(result.outcome!=="ready"||!result.url)throw new Error(result.message||"The PDF preview could not be created.");this.preview.url=result.url;await showPdfPreview(result.url,"Unsaved changes · not an issued PDF");}catch(error){this.announce(error.message||"The PDF preview could not be created.");}},
        copyText(value) { navigator.clipboard.writeText(value); this.announce("Copied current text. It has not been saved by copying."); },
        serializeChanges() {
          const base = this.baseSnapshot; const changes = {};
          if (!this.documentLocked) {
            const document = {}; if (this.proposal.invoice.number !== base.invoice.number) document.number = this.proposal.invoice.number; if (this.proposal.invoice.invoiceDate !== base.invoice.invoiceDate) document.invoiceDate = this.proposal.invoice.invoiceDate; if (Number(this.proposal.invoice.pdfTemplateRevisionId) !== base.invoice.pdfTemplateRevisionId) document.pdfTemplateRevisionId = Number(this.proposal.invoice.pdfTemplateRevisionId); if (this.proposal.refreshParties) document.partyRefreshDigest = base.partyRefresh.digest; if (Object.keys(document).length) changes.document = document;
            const updates = this.proposal.items.filter((item) => item.id && !item.removed).filter((item) => { const old = base.items.find((row) => row.id === item.id); return !old || item.name !== old.name || Math.round(Number(item.value)*100) !== old.value || item.source !== old.source || item.notes !== old.notes; }).map((item) => ({ id:item.id,value:{name:item.name,value:String(item.value),source:item.source,notes:item.notes} }));
            const additions = this.proposal.items.filter((item) => !item.id && !item.removed).map((item) => ({ key:item.key,value:{name:item.name,value:String(item.value),source:item.source,notes:item.notes} })); const removals = this.proposal.items.filter((item) => item.id && item.removed).map((item) => item.id); const order = this.proposal.items.filter((item) => !item.removed).map((item) => item.key); const baseOrder = base.items.map((item) => `id:${item.id}`); if (updates.length || additions.length || removals.length || JSON.stringify(order) !== JSON.stringify(baseOrder)) changes.items = { updates, additions, removals, order };
          }
          if (this.proposal.invoice.notes !== (base.invoice.notes || "")) changes.setNotes = this.proposal.invoice.notes;
          const generatedTexts = this.proposal.generatedTexts.filter((text) => text.content !== (base.generatedTexts.find((row) => row.generatorKey === text.key)?.content ?? "")).map((text) => ({ generatorKey:text.key,generatorName:text.name,sourceSnapshot:text.sourceSnapshot,setContent:text.content })); if (generatedTexts.length) changes.generatedTexts = generatedTexts;
          const updates = this.proposal.records.filter((record) => record.id && !record.removed && comparable(record.values) !== comparable(record.baseValues)).map((record) => { const setFields = {}, clearFields = []; for (const field of record.definitions.fields) { const before = record.baseValues[field.key], after = record.values[field.key]; if (after !== before) { if (after === undefined || after === null || after === "") clearFields.push(field.key); else setFields[field.key] = after; } } return { id:record.id,setFields,clearFields }; });
          const additions = this.proposal.records.filter((record) => !record.id && !record.removed).map((record) => ({ key:record.key,recordTypeId:record.recordTypeId,recordTypeSnapshotDigest:record.recordTypeSnapshotDigest,setFields:record.values })); const removals = this.proposal.records.filter((record) => record.id && record.removed).map((record) => record.id); if (updates.length || additions.length || removals.length) changes.records = { updates, additions, removals };
          const fileAdds = this.proposal.records.flatMap((record) => record.files.filter((file) => file.state === "ready").map((file) => ({ recordKey:record.key,definitionKey:file.definitionKey,token:file.token }))); const fileRemovals=this.proposal.records.flatMap((record)=>record.attachments.filter((file)=>file.pendingRemoval).map((file)=>file.id)); if (fileAdds.length||fileRemovals.length) changes.attachments = { additions:fileAdds,removals:fileRemovals };
          const legacySetFields={},legacyClearFields=[];for(const [local,wire] of [["nfNumber","number"],["issueDate","issueDate"],["verificationCode","verificationCode"],["publicUrl","publicUrl"],["notes","notes"]]){const before=this.proposal.legacy.baseValues[local],after=this.proposal.legacy.values[local];if(after!==before){if(after===null)legacyClearFields.push(wire);else legacySetFields[wire]=after;}}if(Object.keys(legacySetFields).length||legacyClearFields.length)changes.legacy={setFields:legacySetFields,clearFields:legacyClearFields};
          const legacyAdds=this.proposal.legacy.files.filter((file)=>file.state==="ready").map((file)=>({kind:file.kind,token:file.token}));const legacyRemovals=this.proposal.legacy.files.filter((file)=>file.fileId&&file.pendingRemoval).map((file)=>file.kind);if(legacyAdds.length||legacyRemovals.length)changes.legacyAttachments={additions:legacyAdds,removals:legacyRemovals};
          return changes;
        },
        async save() {
          if (!this.ready || !this.editableDirty || this.unresolved || document.activeElement?.matches?.("[contenteditable=true]")) return; if(this.composing){this.saveAfterComposition=true;this.announce("Waiting for text composition to finish before saving.");return;}
          if (this.proposal.records.some((record) => record.files.some((file) => file.state === "uploading" || file.state === "error")) || this.proposal.legacy.files.some((file)=>!file.fileId&&(file.state==="uploading"||file.state==="error"))) { this.showOutcome({ outcome:"rejected",message:"Finish, retry, or remove pending file uploads before saving." }); return; }
          const operationId = crypto.randomUUID(); const changes = this.serializeChanges(); const identity = { schemaVersion:1,kind:"save",editSessionId:this.editSessionId,baseGeneration:this.baseGeneration,baseRevision:this.baseRevision,changes }; const digest = await this.digest(identity); const envelope = { schemaVersion:1,operationId,editSessionId:this.editSessionId,baseGeneration:this.baseGeneration,baseRevision:this.baseRevision,kind:"save",canonicalPayloadDigest:digest,changes };
          this.frozen = structuredClone(envelope); this.expectedIdentity={editSessionId:this.editSessionId,operationId,kind:"save",digest}; this.unresolved = true; this.statusText = "Saving changes…";
          if (!this.persistIdentity({ editSessionId:this.editSessionId,operationId,kind:"save",digest,startedAt:new Date().toISOString() })) { this.unresolved = false; this.statusText = "Unsaved changes"; this.showOutcome({ outcome:"rejected",message:"Recovery identification could not be retained, so the save was not sent." }); return; }
          await this.sendFrozen();
        },
        async sendFrozen() { try { const result = await this.request(`/invoices/${config.invoiceId}/edit-operations`, this.frozen); await this.applyResult(result); } catch(error) { this.beginRecovery("Couldn’t confirm the save. Your changes are still here."); } },
        async checkOperation(operationId, digest) { try { const response = await fetch(`/invoices/${config.invoiceId}/operations/${operationId}`); const result = this.parseResponse(await response.text()); if (result.outcome === "processing" || result.outcome === "unknown") { this.beginRecovery(result.message); return; } if (digest && result.digest && result.digest !== digest) throw new Error("The returned receipt does not match this save."); await this.applyResult(result); } catch(error) { this.beginRecovery(error.message); } },
        beginRecovery(message) { this.unresolved=true; this.statusText="Checking whether changes were saved…"; this.showOutcome({outcome:"unknown",message}); this.renderRecoveryActions(); if (!this.recoveryTimer && this.recoveryAttempt < 4) { const delay=[1000,2000,4000,8000][this.recoveryAttempt++]; this.recoveryTimer=setTimeout(async()=>{this.recoveryTimer=null;if(this.unresolved&&this.expectedIdentity)await this.checkOperation(this.expectedIdentity.operationId,this.expectedIdentity.digest);},delay); } },
        renderRecoveryActions() { const target=this.$root.querySelector("#edit-command-result"); if(!target||target.querySelector("[data-recovery-check]"))return; const actions=document.createElement("div"); actions.className="mt-3 flex flex-wrap gap-2"; actions.innerHTML='<button type="button" class="btn btn-sm" data-recovery-check>Check again</button><button type="button" class="btn btn-ghost btn-sm" data-recovery-retry>Retry same save</button><button type="button" class="btn btn-ghost btn-sm" data-recovery-export>Download my edits</button><button type="button" class="btn btn-ghost btn-sm" data-recovery-leave>Leave anyway</button>'; actions.querySelector("[data-recovery-check]").addEventListener("click",()=>this.expectedIdentity&&this.checkOperation(this.expectedIdentity.operationId,this.expectedIdentity.digest)); actions.querySelector("[data-recovery-retry]").addEventListener("click",()=>this.frozen?this.sendFrozen():this.announce("The page was reloaded before the frozen save payload could be retained.")); actions.querySelector("[data-recovery-export]").addEventListener("click",()=>this.downloadRecovery()); actions.querySelector("[data-recovery-leave]").addEventListener("click",()=>{if(confirm("Leave while the server may still be saving? Selected files cannot be restored after reload."))location.href=`/invoices/${config.invoiceId}`;}); target.append(actions); },
        bindErrorLinks(){if(this._errorLinksBound||!this.$root)return;this._errorLinksBound=true;this.$root.addEventListener("click",(event)=>{const control=event.target.closest?.("[data-error-path]");if(!control)return;event.preventDefault();const path=control.dataset.errorPath;const field=this.$root.querySelector(`[data-field-path="${CSS.escape(path)}"]`);const section=field?.closest?.("[data-workspace-section]")?.dataset.workspaceSection||({setNotes:"text"}[path]);if(section)this.section=section;this.$nextTick(()=>{const mounted=this.$root.querySelector(`[data-field-path="${CSS.escape(path)}"]`);mounted?.focus?.();mounted?.scrollIntoView?.({block:"center"});});});},
        async applyResult(result) {
          this.bindErrorLinks();
          const expected=this.expectedIdentity; if (expected && ((result.operationId && result.operationId!==expected.operationId)||(result.kind && result.kind!==expected.kind)||(result.digest && result.digest!==expected.digest))) { this.statusText="Checking whether changes were saved…";this.showOutcome({outcome:"unknown",message:"A late response did not match the pending save. Check the original operation."});return; }
          if (result.outcome === "committed") { if(this.recoveryTimer)clearTimeout(this.recoveryTimer); this.recoveryTimer=null; this.baseRevision = result.resultingRevision; this.baseGeneration = result.resultingGeneration; this.clearIdentity(); this.expectedIdentity=null; this.unresolved = false; this.editableDirty = false; this.statusText = "Changes saved"; if (!this.retainedDocumentProposal) location.href = `/invoices/${config.invoiceId}`; else this.showRecoverySaved(); return; }
          if (result.outcome === "rejected") { if(this.recoveryTimer)clearTimeout(this.recoveryTimer); this.recoveryTimer=null; this.clearIdentity(); this.expectedIdentity=null; this.unresolved = false; this.statusText = "Unsaved changes"; this.showOutcome(result); this.applyErrors(result.fieldErrors || []); if(["STALE_REVISION","DOCUMENT_LOCKED"].includes(result.code)) this.handleConflict(result); return; }
          this.beginRecovery(result.message);
        },
        handleConflict(result) {
          const changes=this.frozen?.changes||{}; if(changes.document||changes.items){this.retainedDocumentProposal={previouslyLoaded:result.conflict?.previouslyLoaded||this.baseSnapshot,currentSaved:result.conflict?.currentSaved,document:structuredClone({document:changes.document,items:changes.items}),capturedAt:new Date().toISOString()};}
          if(result.currentStatus) { this.documentLocked=result.currentStatus!=="draft"; this.proposal.invoice.status=result.currentStatus; }
          const target=this.$root.querySelector("#edit-conflict-summary"); if(!target)return; target.className="app-card my-4 rounded-xl border-error/40 p-5"; target.innerHTML=""; const heading=document.createElement("h2");heading.tabIndex=-1;heading.className="text-lg font-semibold";heading.textContent="This invoice changed since you opened it"; target.append(heading); const columns=document.createElement("div");columns.className="mt-3 grid gap-3 lg:grid-cols-3";for(const [label,value] of [["Previously loaded",this.retainedDocumentProposal?.previouslyLoaded],["Current saved",this.retainedDocumentProposal?.currentSaved],["Your edit",this.retainedDocumentProposal?.document]]){const card=document.createElement("div");card.className="rounded-lg bg-base-200 p-3";const title=document.createElement("h3");title.className="text-xs font-semibold uppercase";title.textContent=label;const pre=document.createElement("pre");pre.className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-xs";pre.textContent=JSON.stringify(value,null,2);card.append(title,pre);columns.append(card);}target.append(columns);const actions=document.createElement("div");actions.className="mt-4 flex flex-wrap gap-2";actions.innerHTML='<button type="button" class="btn btn-primary btn-sm" data-conflict-keep>Keep editing allowed details</button><a class="btn btn-ghost btn-sm" href="/invoices/'+config.invoiceId+'">Review current invoice</a><button type="button" class="btn btn-ghost btn-sm" data-conflict-download>Download my edits</button>';target.append(actions);actions.querySelector("[data-conflict-keep]").addEventListener("click",()=>this.rebaseAllowed(result));actions.querySelector("[data-conflict-download]").addEventListener("click",()=>this.downloadRecovery());heading.focus();
        },
        async rebaseAllowed(result) {
          if(this.unresolved)return;let payload=this.frozenRebase;if(!payload){const choices=[];if(this.retainedDocumentProposal)choices.push({path:"document.number",resolution:"mine",value:this.proposal.invoice.number},{path:"document.invoiceDate",resolution:"mine",value:this.proposal.invoice.invoiceDate});if(this.proposal.invoice.notes!==(this.baseSnapshot.invoice.notes||""))choices.push({path:"setNotes",resolution:"mine",value:this.proposal.invoice.notes});const identity={editSessionId:this.editSessionId,expectedBaseGeneration:this.baseGeneration,expectedLatestRevision:result.currentRevision,choices};payload={rebaseId:crypto.randomUUID(),...identity,rebaseDigest:await this.digest(identity)};this.frozenRebase=structuredClone(payload);}this.unresolved=true;this.statusText="Rebasing your allowed edits…";try{const rebased=await this.request(`/invoices/${config.invoiceId}/edit-sessions/${this.editSessionId}/rebase`,payload);if(rebased.outcome!=="committed"||rebased.fromGeneration!==payload.expectedBaseGeneration)throw new Error(rebased.message||"Rebase could not be applied.");if(this.baseGeneration!==payload.expectedBaseGeneration)return;this.frozenRebase=null;this.baseGeneration=rebased.toGeneration;this.baseRevision=rebased.observedInvoiceRevision;this.baseSnapshot=rebased.canonicalBase;this.documentLocked=this.baseSnapshot.invoice.status!=="draft";this.unresolved=false;this.editableDirty=true;this.statusText="Review allowed changes, then Save changes";this.showOutcome({outcome:"ready",message:"Current saved data loaded for comparison. Your document proposal is retained; allowed details still require Save changes."});}catch(error){this.unresolved=false;this.statusText="Conflict needs review";this.showOutcome({outcome:"rejected",message:error.message});}
        },
        showRecoverySaved(){this.statusText="Allowed changes saved; document proposal retained";this.showOutcome({outcome:"committed",message:"Your allowed changes were saved. These document edits were not applied."});const target=this.$root.querySelector("#edit-conflict-summary");if(target&&!target.querySelector("[data-dismiss-proposal]")){const button=document.createElement("button");button.type="button";button.dataset.dismissProposal="";button.className="btn btn-ghost btn-sm mt-3";button.textContent="Dismiss proposal";button.addEventListener("click",()=>{if(confirm("Dismiss these document edits? They cannot be saved while the document is locked.")){this.retainedDocumentProposal=null;target.innerHTML="";location.href=`/invoices/${config.invoiceId}`;}});target.append(button);}},
        applyErrors(errors) { this.$root.querySelectorAll("[aria-invalid=true]").forEach((node) => { node.removeAttribute("aria-invalid"); node.removeAttribute("aria-describedby"); }); for (const error of errors) { const field = this.$root.querySelector(`[data-field-path="${CSS.escape(error.path)}"]`); const slot = this.$root.querySelector(`[data-field-error="${CSS.escape(error.path)}"]`); if (field) { field.setAttribute("aria-invalid","true"); if (slot) { const id = slot.id || `error-${crypto.randomUUID()}`; slot.id=id; slot.textContent=error.message; field.setAttribute("aria-describedby",id); } } } const first=errors[0]; if(first){this.section=first.section; this.$nextTick(()=>{const summary=this.$root.querySelector("#edit-error-summary"); summary?.focus(); this.$root.querySelector(`[data-field-path="${CSS.escape(first.path)}"]`)?.scrollIntoView({block:"center"});});}},
        showOutcome(result) { const target = this.$root.querySelector(result.outcome === "rejected" ? "#edit-error-summary" : "#edit-command-result"); if(target){target.className=result.outcome === "rejected"?"alert alert-error my-3":"alert alert-info my-3";target.textContent=result.message||result.outcome;} },
        announce(message) { this.statusText = message; },
        async cancel() { if (this.unresolved) return; if (this.editableDirty && !confirm("Discard all unsaved changes and selected files?")) return; try { await this.request(`/invoices/${config.invoiceId}/edit-sessions/${this.editSessionId}/cancel`, {baseGeneration:this.baseGeneration}); location.href=`/invoices/${config.invoiceId}`; } catch(error){this.showOutcome({outcome:"rejected",message:error.message});} },
        downloadRecovery() { const body={heading:"Unsaved proposal—not an invoice or PDF",schemaVersion:1,invoiceId:config.invoiceId,baseRevision:this.baseRevision,values:this.serializeChanges(),binaryAttachments:"Selected files are excluded and must be selected again after reload."}; const link=document.createElement("a");link.href=URL.createObjectURL(new Blob([JSON.stringify(body,null,2)],{type:"application/json"}));link.download=`invoice-${config.invoiceId}-unsaved-proposal.json`;link.click();URL.revokeObjectURL(link.href); },
        async request(url, body) { const target=this.$root.querySelector("#edit-command-result"); await window.htmx.ajax("POST",url,{target,swap:"innerHTML",headers:{"X-Workspace-Request":"1"},values:{workspaceEnvelope:JSON.stringify(body)}}); const result=this.parseResponse(target.innerHTML); if(!result) throw new Error("The server response could not be matched to this operation."); return result; },
        parseResponse(html) { const document=new DOMParser().parseFromString(html,"text/html"); const node=document.querySelector("[data-workspace-result]"); if(!node) throw new Error("The server response could not be matched to this operation."); return JSON.parse(node.dataset.workspaceResult); },
        async digest(value) { const canonical=(item)=>item===null||typeof item!=="object"?JSON.stringify(item):Array.isArray(item)?`[${item.map(canonical).join(",")}]`:`{${Object.keys(item).sort().map((key)=>`${JSON.stringify(key)}:${canonical(item[key])}`).join(",")}}`; const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(canonical(value)));return [...new Uint8Array(bytes)].map((byte)=>byte.toString(16).padStart(2,"0")).join(""); },
        persistIdentity(identity) { let stored=false; try{sessionStorage.setItem(`pipa:invoice:${config.invoiceId}:pending`,JSON.stringify(identity));stored=true;}catch{} try{location.hash=`operation=${encodeURIComponent(identity.operationId)}&session=${encodeURIComponent(identity.editSessionId)}`;stored=true;}catch{} return stored; },
        pendingIdentity(){try{const stored=JSON.parse(sessionStorage.getItem(`pipa:invoice:${config.invoiceId}:pending`));if(stored)return stored;}catch{}const params=new URLSearchParams(location.hash.replace(/^#/,""));const operationId=params.get("operation"),editSessionId=params.get("session");return operationId&&editSessionId?{operationId,editSessionId,kind:"save",digest:null}:null;}, clearIdentity(){try{sessionStorage.removeItem(`pipa:invoice:${config.invoiceId}:pending`);}catch{} if(location.hash.includes("operation="))history.replaceState(null,"",location.pathname+location.search);},
      };
    });
  });

  /** Flag the nearest savable section as having unsaved changes. */
  function markDirtySection(control) {
    const section = control.closest?.("[data-dirty-section]");
    if (section) section.classList.add("is-dirty-section");
  }

  /** Clear unsaved markers on a form's section(s) — called when it is saved. */
  function clearDirtySections(form) {
    const wrap = form.closest("[data-dirty-section]");
    if (wrap) wrap.classList.remove("is-dirty-section");
    form
      .querySelectorAll("[data-dirty-section].is-dirty-section")
      .forEach((s) => s.classList.remove("is-dirty-section"));
  }

  document.addEventListener("input", (event) => {
    const control = event.target;
    if (
      !(control instanceof HTMLInputElement) &&
      !(control instanceof HTMLTextAreaElement)
    ) {
      return;
    }
    control.dataset.dirty = "true";
    formatControl(control);
    autoGrow(control);
    syncField(control);
    markDirtySection(control);
  });

  // Selects and file inputs fire `change` rather than a useful `input`.
  document.addEventListener("change", (event) => {
    const control = event.target;
    if (
      control instanceof HTMLSelectElement ||
      (control instanceof HTMLInputElement && control.type === "file")
    ) {
      control.dataset.dirty = "true";
      syncField(control);
      markDirtySection(control);
    }
  });

  // Warn before leaving (full-page nav) while any section has unsaved edits.
  window.addEventListener("beforeunload", (event) => {
    if (document.querySelector("[data-dirty-section].is-dirty-section")) {
      event.preventDefault();
      event.returnValue = "";
    }
  });

  document.addEventListener(
    "blur",
    (event) => {
      const control = event.target;
      if (
        !(control instanceof HTMLInputElement) &&
        !(control instanceof HTMLSelectElement) &&
        !(control instanceof HTMLTextAreaElement)
      ) {
        return;
      }
      control.dataset.touched = "true";
      if (
        control instanceof HTMLInputElement ||
        control instanceof HTMLTextAreaElement
      ) {
        control.value = control.value.trim();
      }

      if (control.dataset.format === "money" && control.value) {
        const parsed = Number(control.value);
        if (Number.isFinite(parsed)) control.value = parsed.toFixed(2);
      }

      formatControl(control);
      autoGrow(control);
      syncField(control);
    },
    true,
  );

  document.addEventListener(
    "submit",
    (event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      form.dataset.submitted = "true";
      form.querySelectorAll("input, select, textarea").forEach((control) => {
        control.dataset.touched = "true";
        syncField(control);
      });
      if (form.matches("[data-workspace-form]")) return;
      // Submitting is a save (or a create+redirect): drop the unsaved markers
      // so navigating away after it doesn't trigger the leave warning.
      clearDirtySections(form);
    },
    true,
  );

  document.body.addEventListener("htmx:afterSwap", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    target.querySelectorAll("input, select, textarea").forEach((control) => {
      syncField(control);
      autoGrow(control);
    });
  });

  // Workspace validation/conflict fragments are deliberately swapped beside
  // the mounted form, including for non-2xx responses. File inputs stay alive.
  document.body.addEventListener("htmx:beforeSwap", (event) => {
    if ([202, 409, 410, 422].includes(event.detail.xhr.status)) event.detail.shouldSwap = true;
  });
  const commandRecovery = {
    pending: null, busy: false, timer: null, attempts: 0,
    controls() { return [...document.querySelectorAll('[data-workspace-command]')]; },
    freeze(value) { this.busy = value; this.controls().forEach(button => button.disabled = value); },
    key(id) { return `pipa:invoice:${id}:pending-command`; },
    persist(identity) {
      let ok = false;
      try { sessionStorage.setItem(this.key(identity.invoiceId), JSON.stringify(identity)); ok = true; } catch {}
      try { location.hash = new URLSearchParams({command:identity.operationId, invoice:String(identity.invoiceId), kind:identity.kind, digest:identity.digest}).toString(); ok = true; } catch {}
      return ok;
    },
    clear() {
      const p = this.pending;
      if (this.timer) window.clearTimeout(this.timer);
      this.timer = null;
      try { sessionStorage.removeItem(this.key(p.invoiceId)); } catch {}
      try { history.replaceState(null, '', location.pathname + location.search); } catch {}
      this.pending = null; this.attempts = 0; this.freeze(false);
    },
    show(message) {
      const target = document.querySelector('#invoice-command-result');
      if (!target) return;
      target.className = 'alert alert-warning'; target.replaceChildren();
      const text = document.createElement('p'); text.textContent = message; target.append(text);
      if (!this.pending) return;
      const actions = document.createElement('div'); actions.className = 'flex flex-wrap gap-2';
      const add = (label, action, attribute) => { const button = document.createElement('button'); button.type = 'button'; button.className = 'btn btn-sm'; button.textContent = label; button.setAttribute(attribute, ''); button.onclick = action; actions.append(button); };
      add('Check again', () => this.check(), 'data-command-check');
      if (this.pending.payload) add('Retry same command', () => this.send(), 'data-command-retry');
      const leave = document.createElement('a'); leave.href = '/invoices'; leave.className = 'btn btn-ghost btn-sm'; leave.textContent = 'Leave anyway'; actions.append(leave); target.append(actions);
    },
    recover(message = 'Checking whether the command finished…') {
      this.freeze(true); this.show(message);
      if (!this.timer && this.attempts < 4) this.timer = window.setTimeout(() => { this.timer = null; this.check(); }, [1000,2000,4000,8000][this.attempts++]);
    },
    accept(result) {
      const p = this.pending;
      if (!p || !result || result.operationId !== p.operationId || result.kind !== p.kind || result.digest !== p.digest) { this.recover('The receipt could not be matched. Check the original command.'); return; }
      if (result.outcome === 'committed') { const url = p.kind === 'delete' ? '/invoices' : `/invoices/${p.invoiceId}`; this.clear(); location.href = url; return; }
      if (result.outcome === 'rejected') { this.clear(); this.show(result.message || 'The command was not applied.'); return; }
      this.recover();
    },
    async send() {
      const p = this.pending; if (!p?.payload || this.inFlight) return;
      this.inFlight = true;
      try {
        await window.htmx.ajax('POST', `/invoices/${p.invoiceId}/commands/${p.kind}`, {target:document.querySelector('#invoice-command-result'),swap:'innerHTML',values:{workspaceEnvelope:JSON.stringify(p.payload)}});
        const node = document.querySelector('#invoice-command-result [data-workspace-result]');
        this.accept(node && JSON.parse(node.dataset.workspaceResult));
      } catch { this.recover('Couldn’t confirm the command. Check again before starting another.'); }
      finally { this.inFlight = false; }
    },
    async check() {
      const p = this.pending; if (!p || this.inFlight) return;
      this.inFlight = true;
      try {
        const response = await fetch(`/invoices/${p.invoiceId}/operations/${p.operationId}`);
        const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
        const node = doc.querySelector('[data-workspace-result]');
        this.accept(node && JSON.parse(node.dataset.workspaceResult));
      } catch { this.recover(); }
      finally { this.inFlight = false; }
    },
    restore() {
      if (!document.querySelector('#invoice-command-result')) return;
      const invoiceId = Number(location.pathname.match(/^\/invoices\/(\d+)/)?.[1]); if (!invoiceId) return;
      let identity;
      try { identity = JSON.parse(sessionStorage.getItem(this.key(invoiceId)) || 'null'); } catch {}
      if (!identity) { const hash = new URLSearchParams(location.hash.slice(1)); if (Number(hash.get('invoice')) === invoiceId) identity = {invoiceId, operationId:hash.get('command'), kind:hash.get('kind'), digest:hash.get('digest')}; }
      if (!identity?.operationId || !identity.kind || !identity.digest || (identity.invoiceId && identity.invoiceId !== invoiceId)) return;
      this.pending = {invoiceId, operationId:identity.operationId,kind:identity.kind,digest:identity.digest}; this.freeze(true); this.check();
    },
  };
  commandRecovery.restore();

  document.addEventListener("click", async (event) => {
    const command = event.target.closest?.("[data-workspace-command]");
    if (command) {
      event.preventDefault(); if(commandRecovery.busy)return; const kind=command.dataset.workspaceCommand, invoiceId=Number(command.dataset.invoiceId), expectedRevision=Number(command.dataset.revision); const args=kind==="status"?{status:command.dataset.commandStatus}:{};
      const confirmation=kind==="issue"?"Save a PDF version and lock the invoice document? This does not email the client.":kind==="pdf-version"?"Save a new immutable PDF version? Previous versions remain available.":kind==="revert"?"Revert to draft? Previous PDF versions remain available and the document becomes editable.":kind==="delete"?"Delete this draft invoice? This cannot be undone.":null;if(confirmation&&!confirm(confirmation))return;
      commandRecovery.freeze(true);
      try {
        const operationId=crypto.randomUUID(), digest=await identityDigest({schemaVersion:1,kind,baseRevision:expectedRevision,arguments:args});
        const payload={schemaVersion:1,operationId,expectedRevision,kind,canonicalPayloadDigest:digest,arguments:args};
        const identity={invoiceId,operationId,kind,digest,startedAt:new Date().toISOString()};
        if(!commandRecovery.persist(identity)){commandRecovery.freeze(false);commandRecovery.show("Could not retain recovery identification, so the command was not sent.");return;}
        commandRecovery.pending={...identity,payload}; await commandRecovery.send();
      } catch { commandRecovery.freeze(false);commandRecovery.show("The command could not be prepared and was not sent."); }
      return;
    }
    const savedPreview = event.target.closest?.('[data-pdf-file]');
    if (savedPreview) {
      event.preventDefault(); savedPreview.disabled = true;
      try { await showPdfPreview(savedPreview.dataset.pdfFile, 'Saved PDF · exact archived version'); }
      catch { const target=document.querySelector('#invoice-command-result'); if(target)target.textContent='The PDF viewer could not load. Please try again.'; }
      finally { savedPreview.disabled = false; }
      return;
    }
    const previewButton=event.target.closest?.("[data-pdf-preview]");
    if(previewButton){
      event.preventDefault(); previewButton.disabled=true;
      const target=document.querySelector("#invoice-command-result");
      try {
        const invoiceId=Number(previewButton.dataset.invoiceId),revision=Number(previewButton.dataset.revision),previewId=crypto.randomUUID(),inputDigest=await identityDigest({invoiceId,revision,sourceKind:"current-saved-data"});
        target.textContent='Preparing PDF preview…';
        await window.htmx.ajax("POST",`/invoices/${invoiceId}/previews`,{target,swap:"innerHTML",values:{workspaceEnvelope:JSON.stringify({previewId,sourceKind:"current-saved-data",inputDigest})}});
        const node=target.querySelector("[data-workspace-result]"); const result=node?JSON.parse(node.dataset.workspaceResult):null;
        if(!result?.url)throw new Error(result?.message || 'The PDF preview could not be created.');
        target.replaceChildren();
        await showPdfPreview(result.url,'Current saved data · preview only');
      } catch(error) { target.textContent=error.message || 'The PDF preview could not load.'; }
      finally {previewButton.disabled=false;}
    }
  });
})();
