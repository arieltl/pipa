(() => {
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
})();
