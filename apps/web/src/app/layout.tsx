import type { Metadata, Viewport } from "next";
import { RegisterServiceWorker } from "@/components/register-sw";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cuatro",
  description: "The app your padel four runs on.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Cuatro",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#0b0e14",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body>
        {children}
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
