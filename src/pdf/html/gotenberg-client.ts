import {
  getGotenbergConfig,
  type GotenbergConfig,
} from "../../config/gotenberg.ts";

class GotenbergError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class GotenbergNotConfiguredError extends GotenbergError {}
export class GotenbergTimeoutError extends GotenbergError {}
export class GotenbergConnectionError extends GotenbergError {}
export class GotenbergRequestError extends GotenbergError {}
export class GotenbergUnavailableError extends GotenbergError {}
export class GotenbergInvalidResponseError extends GotenbergError {}
export class GotenbergInvalidPdfError extends GotenbergError {}

export type GotenbergPdfOptions = {
  printBackground?: boolean;
  preferCssPageSize?: boolean;
};

export async function convertHtmlToPdf(
  html: string,
  traceId: string,
  options: GotenbergPdfOptions = {},
  config = getGotenbergConfig(),
): Promise<Buffer> {
  if (!config) throw new GotenbergNotConfiguredError("Gotenberg is not configured");
  const form = new FormData();
  form.append("files", new File([html], "index.html", { type: "text/html; charset=utf-8" }));
  form.append("printBackground", String(options.printBackground ?? true));
  form.append("preferCssPageSize", String(options.preferCssPageSize ?? true));

  let response: Response;
  try {
    response = await fetch(`${config.url}/forms/chromium/convert/html`, {
      method: "POST",
      headers: { "Gotenberg-Trace": traceId },
      body: form,
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (error) {
    if (
      error instanceof DOMException &&
      (error.name === "TimeoutError" || error.name === "AbortError")
    ) {
      throw new GotenbergTimeoutError(
        `Gotenberg did not respond within ${config.timeoutMs} ms`,
      );
    }
    throw new GotenbergConnectionError(
      error instanceof Error ? error.message : "Could not connect to Gotenberg",
    );
  }

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 2_000).trim();
    const message = `Gotenberg returned ${response.status}${detail ? `: ${detail}` : ""}`;
    if (response.status >= 500) throw new GotenbergUnavailableError(message);
    throw new GotenbergRequestError(message);
  }

  const declaredSize = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredSize) && declaredSize > config.maxResponseBytes) {
    throw new GotenbergInvalidResponseError("Gotenberg PDF response is too large");
  }
  const contentType = response.headers.get("content-type");
  if (contentType && !contentType.toLowerCase().includes("application/pdf")) {
    throw new GotenbergInvalidResponseError(
      `Gotenberg returned ${contentType} instead of application/pdf`,
    );
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > config.maxResponseBytes) {
    throw new GotenbergInvalidResponseError("Gotenberg PDF response is too large");
  }
  if (!buffer.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    throw new GotenbergInvalidPdfError("Gotenberg response does not contain a valid PDF signature");
  }
  return buffer;
}

export async function checkGotenbergHealth(
  config: GotenbergConfig | null = getGotenbergConfig(),
): Promise<"unconfigured" | "healthy" | "unhealthy"> {
  if (!config) return "unconfigured";
  try {
    const response = await fetch(`${config.url}/health`, {
      signal: AbortSignal.timeout(Math.min(config.timeoutMs, 5_000)),
    });
    return response.ok ? "healthy" : "unhealthy";
  } catch {
    return "unhealthy";
  }
}
