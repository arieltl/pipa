import {
  formatTemplateSource,
  type FormatTemplateSourceInput,
} from "../src/features/pdf-templates/template-formatter.ts";

interface FormatRequest extends FormatTemplateSourceInput {
  id: number;
}

interface FormatResponse {
  id: number;
  source?: string;
  cursorOffset?: number;
  error?: string;
}

interface FormatterWorkerScope {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<FormatRequest>) => void,
  ): void;
  postMessage(message: FormatResponse): void;
}

// Avoid declaring a global `onmessage`, which conflicts with the project's DOM
// lib during ordinary TypeScript checks.
const workerScope = globalThis as unknown as FormatterWorkerScope;

workerScope.addEventListener("message", (event: MessageEvent<FormatRequest>) => {
  void format(event.data);
});

async function format(request: FormatRequest): Promise<void> {
  try {
    const result = await formatTemplateSource(request);
    post({ id: request.id, ...result });
  } catch (error) {
    post({ id: request.id, error: errorMessage(error) });
  }
}

function post(response: FormatResponse): void {
  workerScope.postMessage(response);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The formatter could not process this file.";
}
