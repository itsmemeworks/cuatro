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
      {/*
       * The global 448px phone-frame clamp that used to live here (DESIGN-AUDIT
       * G1) moved into the responsive shell for the web waves: the (app) group
       * renders inside AppShell (phone branch = the 448 column, wide branches =
       * rail/sidebar/topbar chrome), and the auth/guest routes (login, welcome,
       * join, fc) keep the 448 column at all widths via their own thin layouts
       * wrapping PhoneFrame. not-found.tsx wraps PhoneFrame directly. So the
       * root layout no longer forces a width — each surface owns its frame. It
       * still owns the fonts, the ToastProvider, the STAGING badge, and the
       * service-worker registration. bg-ground stays on the body so the ground
       * always fills behind whichever frame renders.
       */}
      <body className="bg-ground">
        {IS_STAGING && (
          <div className="pointer-events-none fixed left-1/2 top-1 z-[100] -translate-x-1/2 rounded-full bg-ink/75 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-widest text-ground">
            staging
          </div>
        )}
        <ToastProvider>{children}</ToastProvider>
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
