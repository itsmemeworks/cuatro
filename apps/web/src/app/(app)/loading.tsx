/**
 * Warm skeleton for the (app) route group — replaces the cold blank frame
 * that showed while a server component (or a client redirect like /tab →
 * /circles/[id]/tab) resolved. Renders inside the phone-frame column and the
 * bottom nav from (app)/layout.tsx, so it reads as the shell filling in, not
 * a flash of nothing. Pure placeholder blocks in the hairline token, gently
 * pulsing; no copy, since we don't yet know which screen is arriving.
 */
function Block({ className = "" }: { className?: string }) {
  return <div className={`bg-ink-hairline-2 rounded-button ${className}`} />;
}

export default function AppLoading() {
  return (
    <main className="px-5 pt-8 pb-6 flex flex-col gap-6 animate-pulse" aria-hidden>
      <div className="flex items-center justify-between">
        <Block className="h-7 w-32" />
        <Block className="h-9 w-20 rounded-chip" />
      </div>
      <div className="flex flex-col gap-3">
        <Block className="h-28 rounded-card" />
        <Block className="h-28 rounded-card" />
      </div>
    </main>
  );
}
