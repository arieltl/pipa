import { isIP } from "node:net";
import { parseArgs } from "node:util";

/** CLI overrides the environment; direct app startup defaults to loopback. */
export function parseListenOptions(args: string[], defaultHost = "127.0.0.1") {
  const { values } = parseArgs({
    args,
    options: {
      host: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    strict: true,
    allowPositionals: false,
  });
  const hostname = values.host ?? defaultHost;
  if (!values.help && hostname !== "localhost" && isIP(hostname) === 0) {
    throw new Error("Host must be an IP address or localhost (for example --host 0.0.0.0).");
  }
  return { hostname, help: values.help ?? false };
}
