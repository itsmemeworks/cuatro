import type { Metadata, Viewport } from "next";
import { Archivo, IBM_Plex_Mono } from "next/font/google";
import { RegisterServiceWorker } from "@/components/register-sw";
import { ToastProvider } from "@/components/ui/toast";
import "./globals.css";

/*
 * CUATRO's two faces, strict jobs (design/HANDOFF.md):
 * Archivo carries the wordmark (900), titles/numbers-as-heroes (800),
 * labels (700) and body (400-600). IBM Plex Mono is reserved for
 * metadata — timestamps, money, rating context, ledger explanations.
 * "If it's a fact, it's mono." See components/ui/typography.tsx.
 */
const archivo = Archivo({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
  variable: "--font-archivo",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-mono",
  display: "swap",
});

// Baked at build time from fly.staging.toml's [build.args]; prod and local
// dev leave it unset. Gates the STAGING badge and keeps staging out of
// search indexes — staging must never compete with padelcuatro.com.
const IS_STAGING = process.env.NEXT_PUBLIC_APP_ENV === "staging";

export const metadata: Metadata = {
  title: IS_STAGING ? "CUATRO (staging)" : "CUATRO",
  description: "The app your padel four runs on.",
  manifest: "/manifest.json",
  ...(IS_STAGING ? { robots: { index: false, follow: false } } : {}),
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "CUATRO",
  },
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  // Ground follows theme — warm cream in light, warm near-black in dark (never pure white/black).
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FAF8F4" },
    { media: "(prefers-color-scheme: dark)", color: "#131210" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" className={`${archivo.variable} ${plexMono.variable}`}>
      <body>
        {/*
         * The global phone-frame constraint (design/DESIGN-AUDIT.md's G1):
         * CUATRO is a phone experience, so every route — the (app) tab
         * group, login/landing, /join/[code], /fc/[token] — renders inside
         * this single centred column instead of stretching full-width on a
         * desktop viewport. 448px (Tailwind's `max-w-md`) is the value the
         * audit itself names, chosen to sit close to the prototype's 392px
         * device art board plus its 16px inner gutters (392 + 2×16 = 424,
         * rounded up to the nearest standard Tailwind step) while staying a
         * named scale value rather than an arbitrary one-off. Below 448px —
         * i.e. every real phone — this is a no-op: the column just equals
         * the viewport. `min-h-dvh` on the column (not just the outer div)
         * is what makes bg-ground reach the bottom on a short page; the
         * outer div's own bg-ground is what shows in the gutters on a wide
         * viewport.
         */}
        <div className="min-h-dvh bg-ground">
          <div className="relative mx-auto min-h-dvh max-w-[448px] bg-ground text-ink">
            {IS_STAGING && (
              <div className="pointer-events-none fixed left-1/2 top-1 z-[100] -translate-x-1/2 rounded-full bg-ink/75 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-widest text-ground">
                staging
              </div>
            )}
            <ToastProvider>{children}</ToastProvider>
          </div>
        </div>
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
