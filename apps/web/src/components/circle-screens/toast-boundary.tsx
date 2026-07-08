"use client";

import { ToastProvider } from "@/components/ui";

/**
 * A local `<ToastProvider>` scoped to the pages this screen group owns
 * (Circle detail, session/standing-game, Fourth Call). The shared app shell
 * (`app/(app)/layout.tsx`) doesn't mount one — that file is outside this
 * screen group's ownership, and sibling screen groups are editing it
 * concurrently — so each owned page wraps its own client tree in this
 * instead of a single app-wide provider.
 */
export function ToastBoundary({ children }: { children: React.ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}
