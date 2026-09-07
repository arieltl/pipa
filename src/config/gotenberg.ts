export type GotenbergConfig = {
  url: string;
  timeoutMs: number;
  maxResponseBytes: number;
};

export class InvalidGotenbergConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidGotenbergConfigError";
  }
}

export function getGotenbergConfig(): GotenbergConfig | null {
  const raw = process.env.GOTENBERG_URL?.trim();
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new InvalidGotenbergConfigError("GOTENBERG_URL must be a valid HTTP(S) URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new InvalidGotenbergConfigError("GOTENBERG_URL must use HTTP or HTTPS");
  }
  const timeoutValue = process.env.GOTENBERG_TIMEOUT_MS ?? "15000";
  const timeoutRaw = /^\d+$/.test(timeoutValue)
    ? Number.parseInt(timeoutValue, 10)
    : Number.NaN;
  if (!Number.isInteger(timeoutRaw) || timeoutRaw < 1000 || timeoutRaw > 120_000) {
    throw new InvalidGotenbergConfigError(
      "GOTENBERG_TIMEOUT_MS must be between 1000 and 120000",
    );
  }
  return {
    url: parsed.toString().replace(/\/$/, ""),
    timeoutMs: timeoutRaw,
    maxResponseBytes: 25 * 1024 * 1024,
  };
}

export function isGotenbergConfigured(): boolean {
  try {
    return getGotenbergConfig() !== null;
  } catch (error) {
    if (error instanceof InvalidGotenbergConfigError) return false;
    throw error;
  }
}
