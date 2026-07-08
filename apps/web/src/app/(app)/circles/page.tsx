export default function CirclesPage() {
  return (
    <main className="px-5 pt-8 pb-6 flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Circles</h1>
      <div
        className="rounded-2xl p-5 flex flex-col gap-1"
        style={{ background: "var(--c4-bg-elevated)", border: "1px solid var(--c4-border)" }}
      >
        <p className="font-medium">No Circles yet</p>
        <p className="text-sm" style={{ color: "var(--c4-text-muted)" }}>
          Join one with a link or QR code, or create your own — this is where your
          padel group&apos;s chat, history and Standing Games live.
        </p>
      </div>
    </main>
  );
}
