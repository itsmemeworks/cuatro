/**
 * Next.js instrumentation hook — runs once per server process at startup.
 * Wires two things:
 *   1. Sentry server/edge init (per-runtime, dynamically imported so the edge
 *      bundle never pulls the Node config and vice-versa).
 *   2. THE HEARTBEAT (server/scheduler.ts) — started ONCE, only in the Node.js
 *      runtime, and never during the build. The build sets NEXT_PHASE to
 *      "phase-production-build"; guarding on it keeps `next build` from
 *      spinning up a 60s interval that would touch the database at build time.
 *
 * onRequestError forwards Server Component / route / middleware errors to
 * Sentry (Next calls it automatically; no next.config wrapper required).
 */
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }

  const isBuild = process.env.NEXT_PHASE === "phase-production-build";
  if (process.env.NEXT_RUNTIME === "nodejs" && !isBuild) {
    const { startScheduler, setSchedulerErrorReporter } = await import("./server/scheduler");
    setSchedulerErrorReporter((err, context) =>
      Sentry.captureException(err, { tags: { source: "scheduler", context } }),
    );
    startScheduler();
  }
}

export const onRequestError = Sentry.captureRequestError;
