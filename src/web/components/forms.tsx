import type { Child } from "hono/jsx";
import { Icon, type IconName } from "./icons.tsx";

/** First error message per field, as produced from a Zod flattened error. */
export type FieldErrors = Record<string, string | undefined>;

export type FieldProps = {
  label: string;
  name: string;
  hint?: string;
  required?: boolean;
  error?: string;
  children: Child;
};

/**
 * Labeled form control wrapper with hint + error slots. The control itself
 * (input/select/textarea) is passed as children so callers keep full control
 * over attributes (htmx, values, etc.).
 */
export function Field({
  label,
  name,
  hint,
  required,
  error,
  children,
}: FieldProps) {
  return (
    <div class="app-field form-control w-full">
      <label class="label" for={name}>
        <span class="label-text font-medium">
          {label}
          {required ? <span class="text-error"> *</span> : null}
        </span>
      </label>
      {children}
      {error ? (
        <p class="app-error mt-2 text-xs" data-field-error={name}>
          {error}
        </p>
      ) : hint ? (
        <p class="app-hint mt-1.5 text-xs leading-relaxed">{hint}</p>
      ) : null}
    </div>
  );
}

const INPUT_BASE = "app-control input input-bordered w-full";
const TEXTAREA_BASE = "app-control textarea textarea-bordered w-full";
const SELECT_BASE = "app-control select select-bordered w-full";

export function inputClass(error?: string): string {
  return error ? `${INPUT_BASE} input-error` : INPUT_BASE;
}
export function textareaClass(error?: string): string {
  return error ? `${TEXTAREA_BASE} textarea-error` : TEXTAREA_BASE;
}
export function selectClass(error?: string): string {
  return error ? `${SELECT_BASE} select-error` : SELECT_BASE;
}

/** Inline success/error banner for form responses. */
export function Alert({
  kind,
  message,
}: {
  kind: "success" | "error";
  message: string;
}) {
  const cls = kind === "success" ? "alert-success" : "alert-error";
  return (
    <div class={`alert ${cls} lift-enter mb-4 py-2 text-sm shadow-sm`} role="alert">
      <span>{message}</span>
    </div>
  );
}

export function SubmitButton({
  label,
  size,
  formId,
  icon = "check",
  className = "",
}: {
  label: string;
  size?: "sm";
  formId?: string;
  icon?: IconName;
  className?: string;
}) {
  const sizeClass = size === "sm" ? "btn-sm min-w-24" : "min-w-32";
  return (
    <button type="submit" form={formId} class={`btn btn-primary ${sizeClass} ${className}`}>
      <span class="submit-label inline-flex items-center justify-center gap-1.5">
        <Icon name={icon} />
        <span>{label}</span>
      </span>
      <span class="htmx-indicator loading loading-spinner loading-xs"></span>
    </button>
  );
}
