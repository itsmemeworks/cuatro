/**
 * Sentry — edge runtime init (middleware, edge routes). Loaded from
 * instrumentation.ts's register() only when NEXT_RUNTIME === "edge". Same
 * no-DSN-is-a-no-op contract as the server config.
 */
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_APP_ENV ?? "production",
  tracesSampleRate: 0.1,
});
