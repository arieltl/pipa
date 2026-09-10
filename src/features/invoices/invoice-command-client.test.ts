import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";

const source = readFileSync(new URL("../../../assets/app.js", import.meta.url), "utf8");

function page(storage?: Storage) {
  const window = new Window({ url: "http://pipa.test/invoices/7" }); const document=window.document; const calls={posts:0,lookups:0};
  document.body.innerHTML='<div id="invoice-command-result"></div><button data-workspace-command="issue" data-invoice-id="7" data-revision="2">Issue</button><button data-workspace-command="pdf-version" data-invoice-id="7" data-revision="2">Version</button>';
  (window as any).Alpine={data(){}}; (window as any).htmx={ajax:async()=>{calls.posts++;throw new Error("dropped");}}; (window as any).CSS ??= {escape:(x:string)=>x};
  new Function("window","document","sessionStorage","location","history","crypto","CSS","DOMParser","FormData","Blob","URL","HTMLInputElement","HTMLTextAreaElement","HTMLSelectElement","Element","confirm","fetch",source)(window,document,storage??window.sessionStorage,window.location,window.history,globalThis.crypto,(window as any).CSS,window.DOMParser,window.FormData,window.Blob,globalThis.URL,window.HTMLInputElement,window.HTMLTextAreaElement,window.HTMLSelectElement,window.Element,()=>true,async()=>{calls.lookups++;throw new Error("offline");});
  return {window,document,calls};
}

describe("overview command recovery", () => {
  test("a dropped command response retains its identifier and freezes every command", async () => {
    const { window, document, calls }=page(); document.querySelector("button")!.dispatchEvent(new window.Event("click",{bubbles:true})); await new Promise(done=>setTimeout(done,20));
    expect(window.sessionStorage.getItem("pipa:invoice:7:pending-command")).toContain('"kind":"issue"');
    expect([...document.querySelectorAll("[data-workspace-command]")].every(button=>(button as unknown as {disabled:boolean}).disabled)).toBe(true);
    document.querySelectorAll("[data-workspace-command]")[1]!.dispatchEvent(new window.Event("click",{bubbles:true}));
    await new Promise(done=>setTimeout(done,0)); expect(calls.posts).toBe(1);
    expect(document.querySelector("[data-command-check]")).not.toBeNull();
    await window.happyDOM.close();
  });

  test("when both identifier stores fail no command is sent", async () => {
    const storage={getItem:()=>null,setItem:()=>{throw new Error("no storage");},removeItem:()=>{}} as unknown as Storage;
    const {window,document,calls}=page(storage); Object.defineProperty(window.location,"hash",{set(){throw new Error("no fragment");}});
    document.querySelector("button")!.dispatchEvent(new window.Event("click",{bubbles:true})); await new Promise(done=>setTimeout(done,0));
    expect(calls.posts).toBe(0);
    expect(document.querySelector("[data-command-check]")).toBeNull();
    expect((document.querySelector("[data-workspace-command]") as unknown as { disabled: boolean }).disabled).toBe(false);
    await window.happyDOM.close();
  });
  test("reload with a pending identifier performs lookup only", async()=>{
    const saved={invoiceId:7,operationId:crypto.randomUUID(),kind:"issue",digest:"a".repeat(64)};
    const storage={getItem:()=>JSON.stringify(saved),setItem(){},removeItem(){}} as unknown as Storage;
    const {window,document,calls}=page(storage);
    await new Promise(done=>setTimeout(done,0));
    expect(calls.lookups).toBe(1); expect(calls.posts).toBe(0);
    expect(document.querySelector("[data-command-retry]")).toBeNull();
    await window.happyDOM.close();
  });
});
