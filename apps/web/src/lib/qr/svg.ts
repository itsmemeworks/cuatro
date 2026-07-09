import { QrCode, Ecc } from "./qrcodegen";

export { QrCode, Ecc };

/**
 * Build the SVG path `d` for every dark module of a QR symbol, laid out on a
 * 1-unit-per-module grid offset by `border` (the quiet zone, in modules). The
 * caller sets the viewBox to `qr.size + border * 2` and picks the fill colour,
 * so the same path themes cleanly (ink on paper) at any rendered size.
 */
export function qrToPath(qr: QrCode, border: number): string {
  const parts: string[] = [];
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (qr.getModule(x, y)) parts.push(`M${x + border},${y + border}h1v1h-1z`);
    }
  }
  return parts.join("");
}

/** The side length of the rendered symbol in module units, including the quiet zone. */
export function qrViewBoxSize(qr: QrCode, border: number): number {
  return qr.size + border * 2;
}

/**
 * A complete, standalone SVG string (dark modules on a light background). Used
 * by the QR generator's tests and the decode-verification script; the React
 * component (components/ui/qr-code.tsx) builds its own themeable SVG from
 * {@link qrToPath} rather than this string.
 */
export function qrToSvgString(
  text: string,
  opts: { ecl?: Ecc; border?: number; dark?: string; light?: string; mask?: number } = {},
): string {
  const { ecl = Ecc.MEDIUM, border = 4, dark = "#000000", light = "#ffffff", mask = -1 } = opts;
  const qr = QrCode.encodeText(text, ecl, mask);
  const dim = qrViewBoxSize(qr, border);
  const path = qrToPath(qr, border);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="0 0 ${dim} ${dim}" stroke="none">` +
    `<rect width="100%" height="100%" fill="${light}"/>` +
    `<path d="${path}" fill="${dark}"/>` +
    `</svg>`
  );
}
