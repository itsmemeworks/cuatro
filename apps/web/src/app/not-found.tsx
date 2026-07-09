import Link from "next/link";

/**
 * 404. Renders inside the root phone-frame column like every other route.
 * One coral action (back to Home), same recipe as the empty-state cards.
 */
export default function NotFound() {
  return (
    <main className="min-h-dvh px-6 flex flex-col items-center justify-center text-center gap-3">
      <p className="text-cu-hero text-ink tabular-nums">404</p>
      <p className="text-cu-card-title text-ink">This one&apos;s out</p>
      <p className="text-cu-body text-ink-muted max-w-xs">
        Not off the back glass, properly out. The page you were after isn&apos;t here.
      </p>
      <Link
        href="/home"
        className="rounded-button min-h-11 px-6 flex items-center justify-center text-[14px] font-extrabold bg-action text-action-contrast mt-2"
      >
        Back to your week
      </Link>
    </main>
  );
}
