import { describe, expect, it } from "bun:test";
import { createApp } from "./app.tsx";

const app = createApp();

describe("app foundation", () => {
  it("serves the health check", async () => {
    const res = await app.fetch(new Request("http://localhost/healthz"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("renders the dashboard with the full layout", async () => {
    const res = await app.fetch(new Request("http://localhost/"));
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("<!DOCTYPE html>");
    expect(body).toContain("<title>Dashboard");
  });

  it("returns a bare fragment (no layout) for htmx requests", async () => {
    const res = await app.fetch(
      new Request("http://localhost/", {
        headers: { "HX-Request": "true" },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).not.toContain("<html");
    expect(body).toContain("Dashboard");
  });

  it("returns 404 for unknown routes", async () => {
    const res = await app.fetch(
      new Request("http://localhost/does-not-exist"),
    );
    expect(res.status).toBe(404);
  });
});
