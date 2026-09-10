import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "../../db/client.ts";
import { clients, files, invoiceItems, invoiceSequences, invoices } from "../../db/schema.ts";
import { nowIso } from "../../domain/dates.ts";
import { createApp } from "../../app.tsx";
import { createInvoice, getInvoiceDetail } from "./invoices.service.ts";

beforeEach(() => { db.delete(invoiceItems).run(); db.delete(invoices).run(); db.delete(invoiceSequences).run(); db.delete(clients).run(); db.delete(files).run(); });

function fixture() { const now=nowIso(); const client=db.insert(clients).values({name:"Guard",code:`G${crypto.randomUUID().slice(0,8)}`,defaultCurrency:"GBP",numberingProfileId:1,createdAt:now,updatedAt:now}).returning().get(); const invoice=createInvoice({clientId:client.id,invoiceDate:"2026-09-09",currency:"GBP",items:[{name:"x",value:"1.00",source:"other"}]}); return getInvoiceDetail(invoice.id)!; }

describe("retired invoice mutation routes", () => {
  test("every legacy writer rejects before malformed-body parsing or writes", async () => {
    const detail=fixture(), app=createApp(), id=detail.invoice.id, item=detail.items[0]!.id;
    const paths: Array<[string,string]> = [
      ["POST",`/invoices/${id}/status`],["POST",`/invoices/${id}/issue`],["POST",`/invoices/${id}/revert`],["POST",`/invoices/${id}/doc`],["DELETE",`/invoices/${id}`],["POST",`/invoices/${id}/notes`],["POST",`/invoices/${id}/records`],["POST",`/invoices/${id}/records/999/attachments/evidence`],["POST",`/invoices/${id}/nfse/generate`],["POST",`/invoices/${id}/nfse`],["POST",`/invoices/${id}/generated-texts/x/generate`],["POST",`/invoices/${id}/generated-texts/x`],["POST",`/invoices/${id}/archive`],["POST",`/invoices/${id}/refresh-party-details`],["POST",`/invoices/${id}/pdf-template`],["POST",`/invoices/${id}/pdf/archive-download`],["POST",`/invoices/${id}/nfse-link`],["DELETE",`/invoices/${id}/nfse-link/pdf`],["POST",`/invoices/${id}/items`],["POST",`/invoices/${id}/items/${item}`],["DELETE",`/invoices/${id}/items/${item}`],
    ];
    for (const [method,path] of paths) { const response=await app.request(path,{method,headers:{"content-type":"application/json"},body:"{"}); expect(response.status).toBe(409); expect(await response.text()).toContain("STALE_CLIENT"); }
    const after=getInvoiceDetail(id)!; expect(after.invoice.workspaceRevision).toBe(detail.invoice.workspaceRevision); expect(after.invoice.status).toBe("draft"); expect(after.items).toHaveLength(1); expect(db.select().from(files).all()).toHaveLength(0);
  });
});
