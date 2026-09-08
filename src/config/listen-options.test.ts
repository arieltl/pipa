import { expect, test } from "bun:test";
import { parseListenOptions } from "./listen-options.ts";

test("direct startup defaults to IPv4 loopback", () => {
  expect(parseListenOptions([])).toEqual({ hostname: "127.0.0.1", help: false });
});

test("CLI host overrides configured host and supports equals syntax", () => {
  expect(parseListenOptions([], "0.0.0.0").hostname).toBe("0.0.0.0");
  expect(parseListenOptions(["--host", "0.0.0.0"]).hostname).toBe("0.0.0.0");
  expect(parseListenOptions(["--host=127.0.0.1"], "0.0.0.0").hostname).toBe("127.0.0.1");
  expect(parseListenOptions(["--host", "::1"]).hostname).toBe("::1");
  expect(parseListenOptions(["--host", "localhost"]).hostname).toBe("localhost");
});

test("rejects missing, empty, invalid, and unknown arguments", () => {
  for (const args of [["--host"], ["--host="], ["--host", "0.0.0"], ["--host", "https://localhost"], ["--hots", "0.0.0.0"], ["0.0.0.0"]]) {
    expect(() => parseListenOptions(args)).toThrow();
  }
  expect(() => parseListenOptions([], "bad host")).toThrow();
});

test("supports help without requiring a valid environment host", () => {
  expect(parseListenOptions(["--help"], "bad host").help).toBe(true);
  expect(parseListenOptions(["-h"]).help).toBe(true);
});
