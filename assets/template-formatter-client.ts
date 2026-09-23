export { getFormatterForPath, type TemplateFormatter } from "../src/features/pdf-templates/template-formatter-support.ts";

export interface TemplateFormatRequest {
  path: string;
  source: string;
  cursorOffset: number;
}

export interface TemplateFormatResult {
  source: string;
  cursorOffset: number;
}

interface WorkerResponse {
  id: number;
  source?: string;
  cursorOffset?: number;
  error?: string;
}

interface PendingRequest {
  resolve: (result: TemplateFormatResult) => void;
  reject: (reason: Error) => void;
}

export interface TemplateFormatterClientOptions {
  workerUrl?: string;
  timeoutMs?: number;
}

const DEFAULT_WORKER_URL = "/public/template-formatter.worker.mjs";
const DEFAULT_TIMEOUT_MS = 15_000;

/** A lazy, disposable bridge to the isolated browser formatter worker. */
export class TemplateFormatterClient {
  private readonly workerUrl: string;
  private readonly timeoutMs: number;
  private worker: Worker | undefined;
  private nextId = 1;
  private disposed = false;
  private readonly pending = new Map<number, PendingRequest>();
  private timeout: ReturnType<typeof setTimeout> | undefined;

  constructor(options: TemplateFormatterClientOptions = {}) {
    this.workerUrl = options.workerUrl ?? DEFAULT_WORKER_URL;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  format(request: TemplateFormatRequest): Promise<TemplateFormatResult> {
    if (this.disposed) return Promise.reject(new Error("The template formatter has been disposed."));

    const worker = this.getWorker();
    const id = this.nextId++;
    return new Promise<TemplateFormatResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.armTimeout();
      worker.postMessage({ id, ...request });
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.destroyWorker(new Error("The template formatter was disposed before formatting finished."));
  }

  private getWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(this.workerUrl, { type: "module" });
    worker.addEventListener("message", (event: MessageEvent<WorkerResponse>) => this.handleResponse(event.data));
    worker.addEventListener("error", () => {
      this.destroyWorker(new Error("The template formatter worker stopped unexpectedly. Please try again."));
    });
    worker.addEventListener("messageerror", () => {
      this.destroyWorker(new Error("The template formatter returned an invalid response. Please try again."));
    });
    this.worker = worker;
    return worker;
  }

  private handleResponse(response: WorkerResponse): void {
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);
    this.clearTimeoutWhenIdle();

    if (response.error) {
      pending.reject(new Error(`Formatting failed: ${response.error}`));
      return;
    }
    const cursorOffset = response.cursorOffset;
    if (typeof response.source !== "string" || typeof cursorOffset !== "number" || !Number.isInteger(cursorOffset)) {
      pending.reject(new Error("The template formatter returned an invalid response. Please try again."));
      return;
    }
    pending.resolve({ source: response.source, cursorOffset });
  }

  private armTimeout(): void {
    if (this.timeout || this.pending.size === 0) return;
    this.timeout = setTimeout(() => {
      this.destroyWorker(new Error("Formatting timed out. Please try again."));
    }, this.timeoutMs);
  }

  private clearTimeoutWhenIdle(): void {
    if (this.pending.size || !this.timeout) return;
    clearTimeout(this.timeout);
    this.timeout = undefined;
  }

  private destroyWorker(error: Error): void {
    if (this.timeout) clearTimeout(this.timeout);
    this.timeout = undefined;
    this.worker?.terminate();
    this.worker = undefined;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

export function createTemplateFormatterClient(options?: TemplateFormatterClientOptions): TemplateFormatterClient {
  return new TemplateFormatterClient(options);
}
