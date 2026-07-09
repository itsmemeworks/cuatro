import { describe, it, expect } from "vitest";
import { QrCode, Ecc, qrToPath, qrToSvgString, qrViewBoxSize } from "@/lib/qr/svg";

/**
 * The QR generator (src/lib/qr) was verified bit-for-bit against the `qrcode`
 * npm package and decode-tested with `jsQR` outside the repo (see
 * scratchpad/impl-qr.md — that cross-check keeps the app itself dependency
 * free). These tests lock in the structural invariants that make a matrix a
 * real, scannable QR symbol, so a regression here fails loudly.
 */
describe("QR encoder", () => {
  const url = "https://cuatro.fly.dev/join/AB12CD34";

  it("selects the smallest fitting version and the right symbol size (4·v+17)", () => {
    const qr = QrCode.encodeText(url, Ecc.MEDIUM, 2);
    expect(qr.version).toBe(3);
    expect(qr.size).toBe(29);
    expect(qr.size).toBe(qr.version * 4 + 17);
  });

  it("is deterministic for a fixed input + mask (regression fingerprint)", () => {
    const qr = QrCode.encodeText(url, Ecc.MEDIUM, 2);
    let dark = 0;
    for (let y = 0; y < qr.size; y++) for (let x = 0; x < qr.size; x++) if (qr.getModule(x, y)) dark++;
    expect(dark).toBe(455);
  });

  it("draws the three finder patterns (7×7 dark ring, light gap, 3×3 core)", () => {
    const qr = QrCode.encodeText(url, Ecc.MEDIUM);
    const finderAt = (ox: number, oy: number) => {
      // Outer ring dark, inner separator light, 3×3 centre dark.
      expect(qr.getModule(ox, oy)).toBe(true); // top-left corner of ring
      expect(qr.getModule(ox + 1, oy + 1)).toBe(false); // light gap
      expect(qr.getModule(ox + 3, oy + 3)).toBe(true); // centre of core
    };
    finderAt(0, 0); // top-left
    finderAt(qr.size - 7, 0); // top-right
    finderAt(0, qr.size - 7); // bottom-left
  });

  it("draws the timing patterns (alternating modules on row/col 6)", () => {
    const qr = QrCode.encodeText(url, Ecc.MEDIUM);
    for (let i = 8; i < qr.size - 8; i++) {
      expect(qr.getModule(i, 6)).toBe(i % 2 === 0);
      expect(qr.getModule(6, i)).toBe(i % 2 === 0);
    }
  });

  it("grows the version as the payload grows and never exceeds capacity", () => {
    const small = QrCode.encodeText("hi", Ecc.MEDIUM);
    const big = QrCode.encodeText("x".repeat(400), Ecc.MEDIUM);
    expect(big.version).toBeGreaterThan(small.version);
    expect(() => QrCode.encodeText("x".repeat(3000), Ecc.HIGH)).toThrow(/too long/i);
  });

  it("higher error correction never shrinks the version for the same payload", () => {
    const low = QrCode.encodeText(url, Ecc.LOW);
    const high = QrCode.encodeText(url, Ecc.HIGH);
    expect(high.version).toBeGreaterThanOrEqual(low.version);
  });
});

describe("QR SVG rendering", () => {
  it("emits a path with a module rect per dark cell and a quiet-zone-sized viewBox", () => {
    const qr = QrCode.encodeText("hello", Ecc.MEDIUM, 0);
    const border = 4;
    const path = qrToPath(qr, border);
    const rects = path.match(/h1v1h-1z/g)?.length ?? 0;
    let dark = 0;
    for (let y = 0; y < qr.size; y++) for (let x = 0; x < qr.size; x++) if (qr.getModule(x, y)) dark++;
    expect(rects).toBe(dark);
    expect(qrViewBoxSize(qr, border)).toBe(qr.size + border * 2);
    // Every rect sits inside the bordered grid (offset by the quiet zone).
    expect(path).not.toContain("M0,0"); // nothing drawn in the quiet zone corner
  });

  it("produces a standalone SVG string with a light background and a dark path", () => {
    const svg = qrToSvgString("hi", { ecl: Ecc.MEDIUM, dark: "#131210", light: "#faf8f4" });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('fill="#faf8f4"');
    expect(svg).toContain('fill="#131210"');
    expect(svg).toContain("viewBox=");
  });
});
