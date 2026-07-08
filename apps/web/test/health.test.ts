import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/health/route";
import pkg from "../package.json" with { type: "json" };

describe("GET /api/health", () => {
  it("reports ok with the current package version", async () => {
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, version: pkg.version });
  });
});
