/**
 * Sentry — browser init. Next.js auto-loads this file (the
 * `instrumentation-client` convention, Next 15.3+), so no next.config wrapper
 * is needed to wire it. DSN comes from NEXT_PUBLIC_SENTRY_DSN (baked at build
 * time); unset = disabled, never throws. No Session Replay integration by
 * choice — keeps the client bundle small and avoids capturing session content
 * during the pilot.
 */
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_APP_ENV ?? "production",
  tracesSampleRate: 0.1,
});

// Instruments client-side navigations so Sentry can tie errors to the route
// the user was on. Exported for Next to call; a no-op when the DSN is absent.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
