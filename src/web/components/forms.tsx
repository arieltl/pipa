import type { Child } from "hono/jsx";

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
    <div class="form-control w-full">
      <label class="label" for={name}>
        <span class="label-text font-medium">
          {label}
          {required ? <span class="text-error"> *</span> : null}
        </span>
      </label>
      {children}
      {error ? (
        <p class="mt-1 text-sm text-error" data-field-error={name}>
          {error}
        </p>
      ) : hint ? (
        <p class="mt-1 text-sm text-base-content/50">{hint}</p>
      ) : null}
    </div>
  );
}

const INPUT_BASE = "input input-bordered w-full";
const TEXTAREA_BASE = "textarea textarea-bordered w-full";
const SELECT_BASE = "select select-bordered w-full";

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
    <div class={`alert ${cls} mb-4 py-2 text-sm`} role="alert">
      <span>{message}</span>
    </div>
  );
}
