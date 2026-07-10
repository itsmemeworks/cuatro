import { describe, expect, it } from "vitest";
import {
  addPromptedUserId,
  hasBeenPrompted,
  parsePromptedUserIds,
} from "@/lib/entry-cookies";

// The name-step "don't ask again" signal is account-scoped (a comma-separated
// list of user ids), not a device-wide boolean — this is what lets a second
// user on a shared device still get prompted. These cover the primitive the
// callback (hasBeenPrompted) and the welcome action (addPromptedUserId) rely on.
describe("entry-cookies prompted-user list", () => {
  it("parses an empty / missing value as no ids", () => {
    expect(parsePromptedUserIds(undefined)).toEqual([]);
    expect(parsePromptedUserIds(null)).toEqual([]);
    expect(parsePromptedUserIds("")).toEqual([]);
    expect(parsePromptedUserIds(" , ,")).toEqual([]);
  });

  it("parses a comma-separated list, trimming and dropping blanks", () => {
    expect(parsePromptedUserIds("a, b ,c")).toEqual(["a", "b", "c"]);
  });

  it("hasBeenPrompted is true only for an id already in the list", () => {
    expect(hasBeenPrompted("a,b", "b")).toBe(true);
    expect(hasBeenPrompted("a,b", "c")).toBe(false);
    expect(hasBeenPrompted(undefined, "a")).toBe(false);
  });

  it("a legacy device-wide '1' value no longer suppresses a real account (the bug)", () => {
    // Pre-fix cookies held the string "1"; a real UUID must not match it, so
    // an existing device re-prompts its next derived-name user exactly once.
    expect(hasBeenPrompted("1", "some-uuid")).toBe(false);
  });

  it("addPromptedUserId appends a new id and is idempotent for an existing one", () => {
    expect(addPromptedUserId(undefined, "a")).toBe("a");
    expect(addPromptedUserId("a", "b")).toBe("a,b");
    expect(addPromptedUserId("a,b", "a")).toBe("b,a"); // moved to end, not duplicated
    expect(parsePromptedUserIds(addPromptedUserId("a,b", "a"))).toEqual(["b", "a"]);
  });

  it("caps the list so a shared device cannot grow the cookie unbounded", () => {
    let value: string | undefined;
    for (let i = 0; i < 30; i++) value = addPromptedUserId(value, `user-${i}`);
    const ids = parsePromptedUserIds(value);
    expect(ids).toHaveLength(20);
    // oldest fell off, newest retained
    expect(ids).not.toContain("user-0");
    expect(ids[ids.length - 1]).toBe("user-29");
    expect(hasBeenPrompted(value, "user-29")).toBe(true);
  });
});
