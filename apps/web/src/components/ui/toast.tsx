"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { TOAST_DURATION_MS } from "@/lib/design";

/**
 * Toast system: bone surface (the "strong" ink/ground inversion), bottom,
 * 2.1s, 300ms ease in/out (design/HANDOFF.md). Only one toast shows at a
 * time — a new one replaces whatever's showing, matching the app's "never
 * nag twice" rule of thumb rather than queueing up a stack of messages.
 *
 * Usage:
 *   const { show } = useToast();
 *   show("Priya's in — the Lot's full again.");
 */
interface ToastContextValue {
  show: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const show = useCallback((message: string) => {
    clearTimeout(timerRef.current);
    const id = Date.now();
    setToast({ id, message });
    timerRef.current = setTimeout(() => {
      setToast((current) => (current?.id === id ? null : current));
    }, TOAST_DURATION_MS);
  }, []);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div
        className="fixed left-6 right-6 z-50 flex justify-center pointer-events-none"
        style={{ bottom: "calc(var(--c4-nav-height) + var(--safe-bottom) + 12px)" }}
        aria-live="polite"
      >
        {toast && (
          <div
            key={toast.id}
            className="animate-cu-toast bg-strong-bg text-strong-fg rounded-button px-4 py-3 text-[12.5px] font-bold text-center shadow-[0_8px_30px_rgba(0,0,0,0.35)]"
          >
            {toast.message}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast() must be called within a <ToastProvider>");
  return ctx;
}
