/**
 * Validates that `path` is safe to redirect to after magic-link verification
 * (the `?next=` param threaded through /login -> /api/auth/request ->
 * /api/auth/verify — see those files). Only ever allow same-origin relative
 * paths: reject absolute URLs, protocol-relative URLs (`//evil.com`), and
 * anything else an open-redirect could smuggle a scheme through.
 */
export function isSafeRelativePath(path: unknown): path is string {
  if (typeof path !== "string" || path === "") return false;
  if (!path.startsWith("/")) return false;
  if (path.startsWith("//")) return false; // protocol-relative
  if (path.startsWith("/\\")) return false; // some browsers treat \ like /
  if (path.includes("\n") || path.includes("\r")) return false;
  return true;
}
