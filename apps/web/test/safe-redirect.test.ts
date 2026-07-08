import { describe, expect, it } from "vitest";
import { isSafeRelativePath } from "@/lib/safe-redirect";

describe("isSafeRelativePath", () => {
  it("accepts plain relative paths", () => {
    expect(isSafeRelativePath("/join/ABC123")).toBe(true);
    expect(isSafeRelativePath("/circles")).toBe(true);
    expect(isSafeRelativePath("/")).toBe(true);
  });

  it("rejects absolute URLs", () => {
    expect(isSafeRelativePath("https://evil.com")).toBe(false);
    expect(isSafeRelativePath("http://evil.com/join/ABC")).toBe(false);
  });

  it("rejects protocol-relative URLs", () => {
    expect(isSafeRelativePath("//evil.com")).toBe(false);
    expect(isSafeRelativePath("///evil.com")).toBe(false);
  });

  it("rejects paths without a leading slash", () => {
    expect(isSafeRelativePath("join/ABC123")).toBe(false);
    expect(isSafeRelativePath("")).toBe(false);
  });

  it("rejects backslash tricks and control characters", () => {
    expect(isSafeRelativePath("/\\evil.com")).toBe(false);
    expect(isSafeRelativePath("/join/ABC\nSet-Cookie: x=1")).toBe(false);
  });

  it("rejects non-string input", () => {
    expect(isSafeRelativePath(null)).toBe(false);
    expect(isSafeRelativePath(undefined)).toBe(false);
    expect(isSafeRelativePath(42)).toBe(false);
  });
});
