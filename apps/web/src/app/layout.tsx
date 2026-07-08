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

export const metadata: Metadata = {
  title: "CUATRO",
  description: "The app your padel four runs on.",
  manifest: "/manifest.json",
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
        <ToastProvider>{children}</ToastProvider>
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
