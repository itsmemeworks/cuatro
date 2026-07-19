import type { Metadata } from "next";
import { LinkMovedOn } from "@/components/entry/link-fallback";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function NotFound() {
  return <LinkMovedOn />;
}
