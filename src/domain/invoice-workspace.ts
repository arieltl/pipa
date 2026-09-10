import { createHash } from "node:crypto";

/** JSON identity encoding: object keys sort recursively; array order is meaningful. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
}

export function sha256Identity(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function operationIdentity(envelope: {
  schemaVersion: 1;
  kind: string;
  editSessionId?: string;
  baseGeneration?: number;
  baseRevision: number;
  changes?: unknown;
  arguments?: unknown;
}): string {
  return sha256Identity({
    schemaVersion: envelope.schemaVersion,
    kind: envelope.kind,
    ...(envelope.editSessionId ? { editSessionId: envelope.editSessionId } : {}),
    ...(envelope.baseGeneration != null ? { baseGeneration: envelope.baseGeneration } : {}),
    baseRevision: envelope.baseRevision,
    ...(envelope.changes !== undefined ? { changes: envelope.changes } : {}),
    ...(envelope.arguments !== undefined ? { arguments: envelope.arguments } : {}),
  });
}

export type WorkspaceFieldError = { path: string; label: string; message: string; section: "document" | "text" | "records" };

export class WorkspaceValidationError extends Error {
  constructor(public errors: WorkspaceFieldError[]) {
    super(`No changes saved. Review ${errors.length} field${errors.length === 1 ? "" : "s"}.`);
    this.name = "WorkspaceValidationError";
  }
}

export class WorkspaceConflictError extends Error {
  constructor(public code: string, message: string, public currentRevision?: number, public currentStatus?: string) {
    super(message);
    this.name = "WorkspaceConflictError";
  }
}
