import { expect, test } from "bun:test";
import { TemplateFormatterClient } from "../../../assets/template-formatter-client.ts";

class FakeWorker extends EventTarget {
  static instances: FakeWorker[] = [];
  requests: Array<{ id: number; path: string; source: string; cursorOffset: number }> = [];
  terminated = false;
  constructor(..._args: unknown[]) { super(); FakeWorker.instances.push(this); }
  postMessage(request: FakeWorker["requests"][number]) { this.requests.push(request); }
  terminate() { this.terminated = true; }
  reply(data: unknown) { this.dispatchEvent(new MessageEvent("message", { data })); }
}

async function withFakeWorker(run: () => Promise<void>) {
  const original = globalThis.Worker;
  FakeWorker.instances = [];
  globalThis.Worker = FakeWorker as unknown as typeof Worker;
  try { await run(); } finally { globalThis.Worker = original; }
}

const request = { path: "styles.ts", source: "const x={a:1}", cursorOffset: 0 };

test("formatter client is lazy and routes out-of-order replies to the correct request", () => withFakeWorker(async () => {
  const client = new TemplateFormatterClient();
  expect(FakeWorker.instances).toHaveLength(0);
  const first = client.format(request);
  const second = client.format({ ...request, source: "const y=2" });
  const worker = FakeWorker.instances[0]!;
  expect(FakeWorker.instances).toHaveLength(1);
  worker.reply({ id: worker.requests[1]!.id, source: "second", cursorOffset: 2 });
  worker.reply({ id: worker.requests[0]!.id, source: "first", cursorOffset: 1 });
  expect((await first).source).toBe("first");
  expect((await second).source).toBe("second");
  client.dispose();
  expect(worker.terminated).toBe(true);
}));

test("formatter timeout terminates the worker and the next request can recover", () => withFakeWorker(async () => {
  const client = new TemplateFormatterClient({ timeoutMs: 10 });
  await expect(client.format(request)).rejects.toThrow(/timed out/);
  expect(FakeWorker.instances[0]!.terminated).toBe(true);
  const next = client.format(request);
  const worker = FakeWorker.instances[1]!;
  worker.reply({ id: worker.requests[0]!.id, source: "recovered", cursorOffset: 0 });
  expect((await next).source).toBe("recovered");
  client.dispose();
}));

test("formatter disposal rejects in-flight work and prevents reuse", () => withFakeWorker(async () => {
  const client = new TemplateFormatterClient();
  const pending = client.format(request);
  client.dispose();
  await expect(pending).rejects.toThrow(/disposed/);
  await expect(client.format(request)).rejects.toThrow(/disposed/);
  expect(FakeWorker.instances).toHaveLength(1);
}));
