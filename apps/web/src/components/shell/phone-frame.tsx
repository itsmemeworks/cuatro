/*
 * PhoneFrame — the centred 448px phone column.
 *
 * This is the width clamp that used to live in the root app/layout.tsx
 * (DESIGN-AUDIT G1). It moved here so the root layout can stop forcing
 * every route into a phone column: the (app) group now renders inside the
 * responsive AppShell (phone branch = this frame, wide branches = the shell
 * chrome), while the auth/guest routes (login, welcome, join, fc) keep the
 * phone frame at ALL widths via their own thin layouts wrapping this.
 *
 * The markup is byte-for-byte the old root column so nothing below 900px
 * shifts: an outer bg-ground div (what shows in the gutters on a wide
 * viewport) wrapping a centred max-w-[448px] column that carries the real
 * ground + ink and stretches min-h-dvh so bg-ground reaches the bottom on a
 * short page.
 */
export function PhoneFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-ground">
      <div className="relative mx-auto min-h-dvh max-w-[448px] bg-ground text-ink">{children}</div>
    </div>
  );
}
