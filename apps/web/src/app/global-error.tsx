"use client";

/**
 * The last-resort boundary: a crash that escaped even the (app) error.tsx, so
 * it replaces the ROOT layout (must render its own <html>/<body>). Imports
 * globals.css directly for the design tokens, since the layout that normally
 * provides them is exactly what's been torn down. Captures to Sentry and shows
 * a design-system-conformant screen — no raw error message or stack reaches the
 * user (only the opaque `digest`, as a support reference in mono). Copy rules:
 * no exclamation marks, no em dashes, one coral action ("Try again").
 */
import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import "./globals.css";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <main
          style={{
            minHeight: "100dvh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "var(--space-4)",
            padding: "var(--space-6)",
            paddingTop: "calc(var(--safe-top) + var(--space-6))",
            paddingBottom: "calc(var(--safe-bottom) + var(--space-6))",
            textAlign: "center",
            maxWidth: "448px",
            margin: "0 auto",
          }}
        >
          <h1 style={{ fontSize: "1.5rem", lineHeight: 1.2, fontWeight: 800 }}>
            Something went wrong on our end
          </h1>
          <p
            style={{
              color: "var(--color-ink-muted)",
              maxWidth: "34ch",
              lineHeight: 1.5,
            }}
          >
            We have been told and we are looking into it. Try again, and it will
            usually sort itself out.
          </p>

          <button
            type="button"
            onClick={() => reset()}
            style={{
              marginTop: "var(--space-2)",
              minHeight: "var(--touch-target)",
              padding: "0 var(--space-6)",
              borderRadius: "var(--radius-button)",
              border: "none",
              background: "var(--color-action)",
              color: "var(--color-action-contrast)",
              fontFamily: "var(--c4-font-sans)",
              fontWeight: 700,
              fontSize: "1rem",
              cursor: "pointer",
            }}
          >
            Try again
          </button>

          {error.digest ? (
            <p
              style={{
                marginTop: "var(--space-2)",
                fontFamily: "var(--c4-font-mono)",
                fontSize: "0.75rem",
                color: "var(--color-ink-muted)",
              }}
            >
              Reference: {error.digest}
            </p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
