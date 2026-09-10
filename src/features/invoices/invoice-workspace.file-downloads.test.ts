import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "../../db/client.ts";
import { clients, files, invoiceItems, invoiceSequences, invoices } from "../../db/schema.ts";
import { nowIso } from "../../domain/dates.ts";
import { operationIdentity } from "../../domain/invoice-workspace.ts";
import { createApp } from "../../app.tsx";
import { createInvoice, getInvoiceDetail } from "./invoices.service.ts";
import { executeWorkspaceCommand, listInvoicePdfVersions } from "./invoice-workspace.service.ts";

beforeEach(() => { db.delete(invoiceItems).run(); db.delete(invoices).run(); db.delete(invoiceSequences).run(); db.delete(clients).run(); db.delete(files).run(); });
function invoice() { const now=nowIso(), client=db.insert(clients).values({name:"Files",code:`F${crypto.randomUUID().slice(0,8)}`,defaultCurrency:"GBP",numberingProfileId:1,createdAt:now,updatedAt:now}).returning().get(); const inv=createInvoice({clientId:client.id,invoiceDate:"2026-09-09",currency:"GBP",items:[{name:"x",value:"1.00",source:"other"}]}); return getInvoiceDetail(inv.id)!; }
function cmd(id:number,revision:number) { const arguments_={}; return {schemaVersion:1 as const,operationId:crypto.randomUUID(),expectedRevision:revision,kind:"pdf-version" as const,arguments:arguments_,canonicalPayloadDigest:operationIdentity({schemaVersion:1,kind:"pdf-version",baseRevision:revision,arguments:arguments_})}; }
describe("workspace-owned historical downloads",()=>{test("each immutable version stays scoped and byte-identical",async()=>{const first=invoice(), other=invoice();const one=await executeWorkspaceCommand(first.invoice.id,cmd(first.invoice.id,first.invoice.workspaceRevision));const two=await executeWorkspaceCommand(first.invoice.id,cmd(first.invoice.id,one.resultingRevision!));const versions=listInvoicePdfVersions(first.invoice.id);expect(versions).toHaveLength(2);const app=createApp();for(const row of versions){const okay=await app.request(`/invoices/${first.invoice.id}/files/${row.file.id}`);expect(okay.status).toBe(200);expect(new Uint8Array(await okay.arrayBuffer())).toEqual(new Uint8Array(await Bun.file(`${process.env.FILES_DIR}/${row.file.storedPath}`).arrayBuffer()));const forbidden=await app.request(`/invoices/${other.invoice.id}/files/${row.file.id}`);expect(forbidden.status).toBe(404);}})});
