const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Loose shape check for the legacy /g,/p,/c,/r fallback routes — these never
 * do a privileged lookup, so this only decides "valid-looking id -> generic
 * 200" vs "malformed -> designed 404", never whether the id actually exists.
 */
export function looksLikeId(value: string): boolean {
  return UUID_RE.test(value);
}
