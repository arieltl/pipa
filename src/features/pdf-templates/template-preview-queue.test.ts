import { expect, test } from "bun:test";
import { isTemplateEditorDirty, TemplatePreviewQueue } from "./template-preview-queue.ts";

test("template preview queue debounces and keeps only the newest pending source", async () => {
  const calls: string[] = [];
  let finish!: () => void;
  const first = new Promise<void>((resolve) => { finish = resolve; });
  const queue = new TemplatePreviewQueue(async (source) => {
    calls.push(source);
    if (source === "third") await first;
  }, 1);

  queue.schedule("first");
  queue.schedule("second");
  queue.schedule("third");
  await Bun.sleep(10);
  expect(calls).toEqual(["third"]);

  queue.schedule("fourth");
  queue.schedule("fifth");
  await Bun.sleep(10);
  expect(calls).toEqual(["third"]);
  finish();
  await Bun.sleep(10);
  expect(calls).toEqual(["third", "fifth"]);
  queue.destroy();
});

test("destroy cancels a queued preview", async () => {
  const calls: string[] = [];
  const queue = new TemplatePreviewQueue(async (source) => { calls.push(source); }, 5);
  queue.schedule("<html></html>");
  queue.destroy();
  await Bun.sleep(15);
  expect(calls).toEqual([]);
});

test("reopening a preview while a render is active retains the latest requested package", async () => {
  const calls: string[] = [];
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const queue = new TemplatePreviewQueue(async (source) => {
    calls.push(source);
    if (source === "old") await pending;
  });
  queue.retry("old");
  queue.retry("edited while hidden");
  expect(calls).toEqual(["old"]);
  release();
  await Bun.sleep(1);
  expect(calls).toEqual(["old", "edited while hidden"]);
  queue.destroy();
});

test("a failed render does not block the newest queued source", async () => {
  const calls: string[] = [];
  const queue = new TemplatePreviewQueue(async (source) => {
    calls.push(source);
    if (source === "broken") throw new Error("invalid Liquid");
  }, 1);
  queue.retry("broken");
  queue.schedule("fixed");
  await Bun.sleep(15);
  expect(calls).toEqual(["broken", "fixed"]);
  queue.destroy();
});

test("template editor dirty state includes both name and source", () => {
  const initial = { name: "Invoice", source: "<html></html>" };
  expect(isTemplateEditorDirty(initial, initial)).toBe(false);
  expect(isTemplateEditorDirty(initial, { ...initial, name: "Invoice copy" })).toBe(true);
  expect(isTemplateEditorDirty(initial, { ...initial, source: "<html><body></body></html>" })).toBe(true);
});
