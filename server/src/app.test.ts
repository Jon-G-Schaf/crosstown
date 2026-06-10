import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

describe("healthz", () => {
  it("responds ok", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });
});
