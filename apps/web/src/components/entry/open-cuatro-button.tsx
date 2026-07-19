"use client";

/*
 * Deep-links into the native app on click only (never on page load — same
 * law as /auth/callback's fallback screen). `path` is the ORIGINAL canonical
 * path this page was reached at (e.g. `/s/review-held-seat`), so the app
 * receives the exact same token/route and can resolve it with its own,
 * privileged data access — this website never hands the app anything it
 * didn't already have.
 */
const PRIMARY_LG_LINK_CLASS =
  "rounded-button inline-flex items-center justify-center gap-2 select-none transition-cu-state hover:opacity-90 active:opacity-80 w-full min-h-12 px-5 text-[15px] font-extrabold bg-action text-action-contrast border border-transparent";

export function OpenCuatroButton({ path, scheme = "cuatro-beta" }: { path: string; scheme?: string }) {
  return (
    <button
      type="button"
      className={PRIMARY_LG_LINK_CLASS}
      onClick={() => {
        window.location.href = `${scheme}://${path.replace(/^\/+/, "")}`;
      }}
    >
      Open Cuatro
    </button>
  );
}
