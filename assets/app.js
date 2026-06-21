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

    // Create-invoice form: client-aware currency + editable line items before
    // the invoice (and its number) exists. `config` carries initial values and
    // a per-client seed map { clientId: { currency, fixedMonthly } }.
    window.Alpine.data("invoiceCreate", (config) => ({
      clientId: config.clientId || "",
      currency: config.currency || "GBP",
      items: Array.isArray(config.items) ? config.items : [],
      seeds: config.seeds || {},

      get currencyDefault() {
        return this.seeds[this.clientId]?.currency || "";
      },

      get total() {
        return this.items.reduce((acc, item) => {
          const n = parseFloat(String(item.value).replace(",", "."));
          return acc + (Number.isFinite(n) ? n : 0);
        }, 0);
      },

      get formattedTotal() {
        return `${this.currency} ${this.total.toFixed(2)}`;
      },

      onClientChange() {
        const seed = this.seeds[this.clientId];
        if (!seed) return;
        this.currency = seed.currency;
        // Re-seed the fixed monthly row, keeping any user-added rows.
        const extras = this.items.filter((it) => it.source !== "fixed_monthly");
        this.items = seed.fixedMonthly ? [seed.fixedMonthly, ...extras] : extras;
      },

      addItem() {
        this.items.push({ name: "", value: "", source: "other", notes: "" });
      },

      removeItem(i) {
        this.items.splice(i, 1);
      },
    }));
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

  // Selects fire `change` rather than a useful `input` in some browsers.
  document.addEventListener("change", (event) => {
    if (event.target instanceof HTMLSelectElement) {
      markDirtySection(event.target);
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
