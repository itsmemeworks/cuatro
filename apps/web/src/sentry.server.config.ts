/**
 * Sentry — Node.js server runtime init. Loaded from instrumentation.ts's
 * register() only when NEXT_RUNTIME === "nodejs". No DSN (SENTRY_DSN unset, as
 * in local dev) makes Sentry.init() a no-op that never throws, so this is safe
 * to run in every environment.
 */
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_APP_ENV ?? "production",
  // Keep tracing light — this is error visibility for a pilot, not a full APM
  // rollout. Bump when we actually need latency data.
  tracesSampleRate: 0.1,
});
