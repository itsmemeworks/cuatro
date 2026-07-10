import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestClient, type CuatroClient } from "@cuatro/db";
import pkg from "../package.json" with { type: "json" };

// The health route reads through the @/server/db singleton. Swap it for a
// controllable stand-in: a real PGlite client (so "ok" is a genuine round-trip)
// or one whose execute() rejects (so "error" exercises the 503 path).
let mode: "real" | "error" = "real";
let realClient: CuatroClient;

vi.mock("@/server/db", () => ({
  getDb: async () => {
    if (mode === "error") {
      return { db: { execute: () => Promise.reject(new Error("db down")) }, close: async () => {} };
    }
    return realClient;
  },
  __resetDbForTests: () => {},
}));

import { GET } from "@/app/api/health/route";

describe("GET /api/health", () => {
  beforeEach(async () => {
    realClient = await createTestClient();
    mode = "real";
  });

  afterEach(async () => {
    await realClient.close();
  });

  it("returns 200 with db:ok when the database answers", async () => {
    mode = "real";
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, version: pkg.version, db: "ok" });
  });

  it("returns 503 with db:error when the database read fails", async () => {
    mode = "error";
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(503);
    expect(body).toEqual({ ok: false, version: pkg.version, db: "error" });
  });
});
