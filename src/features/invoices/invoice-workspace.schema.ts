import { z } from "zod";
import { ITEM_SOURCES } from "./invoices.schema.ts";

const uuid = z.uuid();
const existingKey = z.string().regex(/^id:\d+$/);
const temporaryKey = z.string().regex(/^tmp:[0-9a-f-]{36}$/i);
const rowKey = z.union([existingKey, temporaryKey]);
const strictStringMap = z.record(z.string().max(64), z.union([z.string().max(100000), z.boolean()]));

const itemValue = z.object({
  name: z.string().max(300),
  value: z.string().max(30),
  source: z.enum(ITEM_SOURCES),
  notes: z.string().max(1000).nullable(),
}).strict();

const records = z.object({
  updates: z.array(z.object({ id: z.number().int().positive(), setFields: strictStringMap, clearFields: z.array(z.string().max(64)) }).strict()),
  additions: z.array(z.object({ key: temporaryKey, recordTypeId: z.number().int().positive(), recordTypeSnapshotDigest: z.string().regex(/^[a-f0-9]{64}$/), setFields: strictStringMap }).strict()),
  removals: z.array(z.number().int().positive()),
}).strict();

export const workspaceChangesSchema = z.object({
  document: z.object({
    number: z.string().max(60).optional(),
    invoiceDate: z.string().max(10).optional(),
    pdfTemplateRevisionId: z.number().int().positive().optional(),
    partyRefreshDigest: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  }).strict().optional(),
  items: z.object({
    updates: z.array(z.object({ id: z.number().int().positive(), value: itemValue }).strict()),
    additions: z.array(z.object({ key: temporaryKey, value: itemValue }).strict()),
    removals: z.array(z.number().int().positive()),
    order: z.array(rowKey),
  }).strict().optional(),
  setNotes: z.string().max(2000).optional(),
  generatedTexts: z.array(z.object({ generatorKey: z.string().min(1).max(64), generatorName: z.string().min(1).max(200), sourceSnapshot: z.string().max(100000), setContent: z.string().max(100000) }).strict()).optional(),
  records: records.optional(),
  legacy: z.object({ setFields: strictStringMap, clearFields: z.array(z.string().max(64)) }).strict().optional(),
  legacyAttachments: z.object({ additions: z.array(z.object({ kind: z.enum(["pdf", "xml"]), token: z.string().min(20).max(200) }).strict()), removals: z.array(z.enum(["pdf", "xml"])) }).strict().optional(),
  attachments: z.object({
    additions: z.array(z.object({ recordKey: rowKey, definitionKey: z.string().min(1).max(64), token: z.string().min(20).max(200) }).strict()),
    removals: z.array(z.number().int().positive()),
  }).strict().optional(),
}).strict();

export const workspaceSaveEnvelopeSchema = z.object({
  schemaVersion: z.literal(1), operationId: uuid, editSessionId: uuid,
  baseGeneration: z.number().int().positive(), baseRevision: z.number().int().nonnegative(),
  kind: z.literal("save"), canonicalPayloadDigest: z.string().regex(/^[a-f0-9]{64}$/),
  changes: workspaceChangesSchema,
}).strict();

export const createEditSessionSchema = z.object({ editSessionId: uuid, desiredBaseRevision: z.number().int().nonnegative() }).strict();
export const rebaseSchema = z.object({
  rebaseId: uuid, editSessionId: uuid, expectedBaseGeneration: z.number().int().positive(),
  expectedLatestRevision: z.number().int().nonnegative(), rebaseDigest: z.string().regex(/^[a-f0-9]{64}$/),
  choices: z.array(z.object({ path: z.string().min(1).max(300), resolution: z.enum(["latest", "mine", "discard", "recreate"]), value: z.unknown().optional() }).strict()).max(500),
}).strict();
export const cancelEditSessionSchema = z.object({ baseGeneration: z.number().int().positive() }).strict();
export const commandSchema = z.object({ schemaVersion: z.literal(1), operationId: uuid, expectedRevision: z.number().int().nonnegative(), kind: z.enum(["issue", "pdf-version", "status", "revert", "delete"]), canonicalPayloadDigest: z.string().regex(/^[a-f0-9]{64}$/), arguments: z.object({ status: z.string().optional(), dependencySignature: z.string().optional() }).strict() }).strict();
export const generatorPreviewSchema = z.object({ sequence: z.number().int().nonnegative(), inputDigest: z.string().regex(/^[a-f0-9]{64}$/), generatorKey: z.string().min(1).max(64), proposal: workspaceChangesSchema }).strict();
export const pdfPreviewSchema = z.object({ previewId: uuid, sourceKind: z.enum(["current-saved-data","saved-version","workspace-proposal"]), inputDigest: z.string().regex(/^[a-f0-9]{64}$/), editSessionId: uuid.optional(), baseGeneration: z.number().int().positive().optional(), proposal: workspaceChangesSchema.optional() }).strict().superRefine((value, ctx) => { if (value.sourceKind === "workspace-proposal" && (!value.editSessionId || !value.baseGeneration || !value.proposal)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A workspace preview requires its editing session and proposal." }); });

export type WorkspaceSaveEnvelope = z.infer<typeof workspaceSaveEnvelopeSchema>;
export type WorkspaceChanges = z.infer<typeof workspaceChangesSchema>;
export type RebaseInput = z.infer<typeof rebaseSchema>;
export type WorkspaceCommandInput = z.infer<typeof commandSchema>;
