import { PhoneFrame } from "@/components/shell/phone-frame";

/*
 * Fourth Call guest landing (/fc/[token]) keeps the centred 448 phone column
 * at ALL widths — the root layout no longer applies the clamp (it moved into
 * the responsive shell for the web waves).
 */
export default function FourthCallLayout({ children }: { children: React.ReactNode }) {
  return <PhoneFrame>{children}</PhoneFrame>;
}
