import { describe, expect, it } from "vitest";
import { resolveGuestFlowInitial } from "@/app/fc/[token]/guest-flow-initial";
import { GUEST_PLACEHOLDER_NAME } from "@/server/guest";

// QA6's top finding: a FULL session's public /fc link kept showing the live
// "I can play, claim it" CTA — a guest only learned the truth after tapping.
// The landing must tell the truth up front; these pin the step decision.
describe("resolveGuestFlowInitial (/fc/[token] anonymous landing)", () => {
  it("a cold visitor on an open session starts at claim", () => {
    expect(resolveGuestFlowInitial({ isFull: false, confirmed: undefined, reserved: undefined })).toEqual({
      step: "claim",
    });
  });

  it("a cold visitor on a FULL session lands on the honest beaten state, never a live claim CTA", () => {
    expect(resolveGuestFlowInitial({ isFull: true, confirmed: undefined, reserved: undefined })).toEqual({
      step: "beaten",
    });
  });

  it("a returning guest mid-claim (placeholder name) resumes at the name step even when the session is full — their hold is part of why it's full", () => {
    expect(
      resolveGuestFlowInitial({
        isFull: true,
        confirmed: { displayName: GUEST_PLACEHOLDER_NAME, avatarUrl: null },
        reserved: undefined,
      }),
    ).toEqual({ step: "name", status: "in" });
  });

  it("a returning named guest resumes at done with their own status, full or not", () => {
    expect(
      resolveGuestFlowInitial({
        isFull: true,
        confirmed: { displayName: "Jess", avatarUrl: null },
        reserved: undefined,
      }),
    ).toEqual({ step: "done", status: "in", displayName: "Jess", avatarUrl: null });

    expect(
      resolveGuestFlowInitial({
        isFull: true,
        confirmed: undefined,
        reserved: { displayName: "Jess", avatarUrl: "/a.png" },
      }),
    ).toEqual({ step: "done", status: "reserve", displayName: "Jess", avatarUrl: "/a.png" });
  });

  it("a reserve-queue guest still naming themselves resumes at name with reserve status", () => {
    expect(
      resolveGuestFlowInitial({
        isFull: false,
        confirmed: undefined,
        reserved: { displayName: GUEST_PLACEHOLDER_NAME, avatarUrl: null },
      }),
    ).toEqual({ step: "name", status: "reserve" });
  });
});
