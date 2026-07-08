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

/**
 * Resolves the externally-visible origin (scheme + host) for building
 * absolute redirect URLs in route handlers (auth verify/logout/request).
 *
 * `NextRequest.nextUrl.origin` is derived from the origin the Next.js
 * server itself believes it's serving on — inside the Fly.io deploy
 * (Dockerfile sets `HOSTNAME=0.0.0.0`, `PORT=3000`) that degrades to
 * `https://0.0.0.0:3000` whenever the inbound request doesn't carry a
 * Host header Next can resolve against, producing a magic-link/logout
 * redirect that points at the container's bind address instead of
 * `https://cuatro.fly.dev`. Fly's edge proxy always sets
 * `X-Forwarded-Proto`, and forwards the client-facing hostname via either
 * `X-Forwarded-Host` or a correct `Host` header — prefer those, in that
 * order, before ever trusting `nextUrl.origin`/`nextUrl.host`. Falls back
 * to `http://localhost:3000` only when neither is present at all (e.g. a
 * malformed request in local dev).
 */
export function resolveRequestOrigin(request: { headers: Headers; nextUrl: URL }): string {
  const host =
    request.headers.get("x-forwarded-host") ??
    request.headers.get("host") ??
    (request.nextUrl.hostname !== "0.0.0.0" ? request.nextUrl.host : null);
  if (!host) return "http://localhost:3000";

  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const isLocal = host.startsWith("localhost") || host.startsWith("127.0.0.1");
  const proto = forwardedProto || (isLocal ? "http" : "https");
  return `${proto}://${host}`;
}
