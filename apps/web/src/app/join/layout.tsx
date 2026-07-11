import { PhoneFrame } from "@/components/shell/phone-frame";

/*
 * Circle invite landing (/join/[code]) keeps the centred 448 phone column at
 * ALL widths — the root layout no longer applies the clamp (it moved into the
 * responsive shell for the web waves).
 */
export default function JoinLayout({ children }: { children: React.ReactNode }) {
  return <PhoneFrame>{children}</PhoneFrame>;
}
