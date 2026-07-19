import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { resolveShareLink, type ShareLinkView } from "@/server/share-link";
import { OpenCuatroButton } from "@/components/entry/open-cuatro-button";
import { TestflightCta } from "@/components/entry/link-fallback";
import { Meta } from "@/components/ui";

/**
 * Opaque share-link fallback (/s/[token]). The RPC (resolve_share_link) is
 * the ONLY thing this route touches — never the share_links table directly,
 * never a service-role key. Tokens are opaque: no format check is possible
 * or meaningful, only the RPC decides. `null`, any RPC error, an
 * unrecognised shape, or an unsupported `kind` are all the SAME outcome —
 * the designed not-found page — so a token's prior existence is never
 * revealed by a different failure mode. The token itself is never logged,
 * sent to analytics, or put in an error message anywhere in this path.
 */

/** The request's own origin (world-ready: never hardcode a domain). Mirrors app/courts/[slug]/page.tsx. */
async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return "http://localhost:3000";
  const forwardedProto = h.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const isLocal = host.startsWith("localhost") || host.startsWith("127.0.0.1");
  const proto = forwardedProto || (isLocal ? "http" : "https");
  return `${proto}://${host}`;
}

const LONDON_FORMAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

function formatLocal(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return LONDON_FORMAT.format(d);
}

function metaFor(view: ShareLinkView | null, origin: string, token: string) {
  const url = `${origin}/s/${token}`;
  const image = `${origin}/api/og/share/${token}`;
  if (!view) {
    return {
      title: "This Cuatro link has moved on",
      description: "Whoever sent it can make a fresh one from inside the app.",
      url,
      image: null as string | null,
    };
  }
  switch (view.kind) {
    case "game": {
      const when = formatLocal(view.startsAt);
      const title = view.heldSeat != null ? "A seat is waiting for you" : "A Cuatro game was shared with you";
      const description = view.circleName
        ? `${view.circleName} · ${view.venueName} · ${when}`
        : `${view.venueName} · ${when}`;
      return { title, description, url, image };
    }
    case "circle":
      return { title: "A Cuatro Circle was shared with you", description: "See what it is inside the app.", url, image };
    case "profile":
      return { title: `Meet ${view.firstName} on Cuatro`, description: "See their Glass and their four inside the app.", url, image };
    case "result":
      return { title: "A sealed Cuatro result was shared with you", description: "See the result inside the app.", url, image };
  }
}

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const origin = await requestOrigin();
  const view = await resolveShareLink(token);
  const meta = metaFor(view, origin, token);

  return {
    title: `${meta.title} · CUATRO`,
    description: meta.description,
    alternates: { canonical: meta.url },
    robots: { index: false, follow: false },
    openGraph: {
      title: meta.title,
      description: meta.description,
      url: meta.url,
      images: meta.image ? [{ url: meta.image, width: 1200, height: 630 }] : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title: meta.title,
      description: meta.description,
      images: meta.image ? [meta.image] : undefined,
    },
  };
}

export default async function ShareLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = await resolveShareLink(token);
  if (!view) notFound();

  const scheme = process.env.CUATRO_URL_SCHEME || "cuatro-beta";
  const path = `/s/${token}`;

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-5 px-6 py-12 text-center">
      <img src="/landing/img/app-icon.png" width={56} height={56} alt="" className="rounded-[16px] object-cover" />

      {view.kind === "game" && <GamePreview view={view} />}
      {view.kind === "circle" && (
        <>
          <h1 className="text-[22px] font-extrabold tracking-tight text-ink">A Cuatro Circle was shared with you</h1>
          <p className="max-w-[320px] text-[14px] leading-[1.5] text-ink-muted">
            Its games, its chat, its Standing Game. See what it is inside the app.
          </p>
        </>
      )}
      {view.kind === "profile" && (
        <>
          <h1 className="text-[22px] font-extrabold tracking-tight text-ink">Meet {view.firstName} on Cuatro</h1>
          <p className="max-w-[320px] text-[14px] leading-[1.5] text-ink-muted">
            See their Glass and their four inside the app.
          </p>
        </>
      )}
      {view.kind === "result" && (
        <>
          <h1 className="text-[22px] font-extrabold tracking-tight text-ink">A sealed Cuatro result was shared with you</h1>
          <p className="max-w-[320px] text-[14px] leading-[1.5] text-ink-muted">Who played, who won. See it inside the app.</p>
        </>
      )}

      <div className="mt-2 flex w-full max-w-[320px] flex-col gap-2.5">
        <OpenCuatroButton path={path} scheme={scheme} />
        <TestflightCta />
      </div>
    </main>
  );
}

function GamePreview({ view }: { view: Extract<ShareLinkView, { kind: "game" }> }) {
  const when = formatLocal(view.startsAt);
  return (
    <>
      {view.heldSeat != null && (
        <span className="rounded-chip border border-dashed border-action px-3 py-1 text-[11px] font-bold text-action">
          one place is waiting for you
        </span>
      )}
      <h1 className="text-[22px] font-extrabold tracking-tight text-ink">
        {view.circleName ? view.circleName : "A Cuatro game"}
      </h1>
      <Meta as="p">
        {view.venueName} · {when}
      </Meta>
      {view.players.length > 0 && (
        <p className="max-w-[320px] text-[14px] leading-[1.5] text-ink-muted">
          {view.players
            .slice()
            .sort((a, b) => a.seatNumber - b.seatNumber)
            .map((p) => p.firstName)
            .join(", ")}
        </p>
      )}
    </>
  );
}
