import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { limit, clientIp, __resetRateLimitForTests } from "@/lib/rate-limit";

// The limiter reads only Date.now(), so we drive time by setting the system
// clock at absolute points rather than running any timers.
function at(ms: number) {
  vi.setSystemTime(ms);
}

describe("rate-limit limiter", () => {
  beforeEach(() => {
    __resetRateLimitForTests();
    vi.useFakeTimers();
    at(1_000_000); // arbitrary non-zero epoch base
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("sliding window", () => {
    it("allows up to max within the window, then denies", () => {
      const opts = { max: 2, windowMs: 1000 };
      expect(limit("k", opts).allowed).toBe(true);
      expect(limit("k", opts).allowed).toBe(true);
      expect(limit("k", opts).allowed).toBe(false);
    });

    it("frees the window as the oldest hit ages out, not all at once", () => {
      const base = 1_000_000;
      const opts = { max: 2, windowMs: 1000 };

      at(base);
      limit("k", opts); // hit 1 at t=0
      at(base + 400);
      limit("k", opts); // hit 2 at t=400
      at(base + 500);
      expect(limit("k", opts).allowed).toBe(false); // full: 2 hits in window

      // At t=1001 the first hit (t=0) has aged out; one slot frees, the second
      // (t=400) has not — so exactly one more is allowed, then denied again.
      at(base + 1001);
      expect(limit("k", opts).allowed).toBe(true);
      expect(limit("k", opts).allowed).toBe(false);
    });

    it("keys are independent", () => {
      const opts = { max: 1, windowMs: 1000 };
      expect(limit("a", opts).allowed).toBe(true);
      expect(limit("b", opts).allowed).toBe(true);
      expect(limit("a", opts).allowed).toBe(false);
    });
  });

  describe("retryAfterSeconds", () => {
    it("is 0 when allowed", () => {
      expect(limit("k", { max: 1, windowMs: 10_000 }).retryAfterSeconds).toBe(0);
    });

    it("reports whole seconds until the oldest hit expires, shrinking over time", () => {
      const base = 1_000_000;
      const opts = { max: 1, windowMs: 10_000 };

      at(base);
      limit("k", opts); // hit at t=0
      at(base);
      expect(limit("k", opts).retryAfterSeconds).toBe(10); // full 10s window ahead

      at(base + 3000);
      expect(limit("k", opts).retryAfterSeconds).toBe(7); // 7s left

      at(base + 9999);
      expect(limit("k", opts).retryAfterSeconds).toBe(1); // rounds up, never 0 while denied

      at(base + 10_001);
      expect(limit("k", opts).allowed).toBe(true); // window cleared
    });
  });

  describe("memory-bounded eviction (LRU)", () => {
    it("evicts the least-recently-used key once over the cap", () => {
      const opts = { max: 1, windowMs: 60_000 };
      const CAP = 10_000; // MAX_KEYS in the limiter

      // Fill exactly to the cap: k0 is the least-recently-used from here on.
      for (let i = 0; i < CAP; i++) {
        expect(limit(`k${i}`, opts).allowed).toBe(true);
      }

      // A recent key is at its max, so a second hit is denied (proves state
      // is retained for keys still resident).
      expect(limit(`k${CAP - 1}`, opts).allowed).toBe(false);

      // One new key pushes us over the cap and evicts the stalest (k0).
      expect(limit("overflow", opts).allowed).toBe(true);

      // k0's history was dropped, so it reads as fresh (allowed) rather than
      // denied — that is the eviction, observed behaviourally.
      expect(limit("k0", opts).allowed).toBe(true);
    });
  });
});

describe("clientIp", () => {
  it("prefers fly-client-ip", () => {
    const req = new Request("https://x/", { headers: { "fly-client-ip": "1.2.3.4", "x-forwarded-for": "9.9.9.9" } });
    expect(clientIp(req)).toBe("1.2.3.4");
  });

  it("falls back to the first x-forwarded-for hop", () => {
    const req = new Request("https://x/", { headers: { "x-forwarded-for": "5.6.7.8, 10.0.0.1" } });
    expect(clientIp(req)).toBe("5.6.7.8");
  });

  it("returns a constant when no IP header is present, so a missing header cannot fan out into unlimited keys", () => {
    const req = new Request("https://x/");
    expect(clientIp(req)).toBe("unknown");
  });
});
