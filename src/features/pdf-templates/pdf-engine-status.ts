import {
  getGotenbergConfig,
  InvalidGotenbergConfigError,
} from "../../config/gotenberg.ts";
import { checkGotenbergHealth } from "../../pdf/html/gotenberg-client.ts";

export type GotenbergStatus = {
  state: "unconfigured" | "healthy" | "unhealthy" | "invalid";
  message: string;
};

type CachedStatus = {
  key: string;
  checkedAt: number;
  value: GotenbergStatus;
};

let cached: CachedStatus | null = null;
const STATUS_TTL_MS = 10_000;

/**
 * Status is only advisory UI state. Rendering never depends on this health
 * probe: the conversion request remains the authoritative availability check.
 */
export async function getGotenbergStatus(force = false): Promise<GotenbergStatus> {
  try {
    const config = getGotenbergConfig();
    if (!config) {
      return {
        state: "unconfigured",
        message: "Not configured. React PDF remains available.",
      };
    }

    const key = `${config.url}|${config.timeoutMs}`;
    if (
      !force &&
      cached?.key === key &&
      Date.now() - cached.checkedAt < STATUS_TTL_MS
    ) {
      return cached.value;
    }

    const health = await checkGotenbergHealth(config);
    const value: GotenbergStatus =
      health === "healthy"
        ? { state: "healthy", message: `Connected to ${config.url}.` }
        : {
            state: "unhealthy",
            message: `Configured at ${config.url}, but the health check failed.`,
          };
    cached = { key, checkedAt: Date.now(), value };
    return value;
  } catch (error) {
    if (error instanceof InvalidGotenbergConfigError) {
      return { state: "invalid", message: error.message };
    }
    throw error;
  }
}

export function htmlRenderingBlockedReason(status: GotenbergStatus): string | undefined {
  if (status.state === "healthy") return undefined;
  if (status.state === "unconfigured") {
    return "HTML PDF rendering is not configured. Set GOTENBERG_URL or choose a React PDF template.";
  }
  if (status.state === "invalid") {
    return `HTML PDF configuration is invalid: ${status.message}`;
  }
  return "Gotenberg is currently unavailable. Retry the connection check or choose a React PDF template.";
}
