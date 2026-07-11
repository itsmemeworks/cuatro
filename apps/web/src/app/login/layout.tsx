import { PhoneFrame } from "@/components/shell/phone-frame";

/*
 * Auth entry keeps the centred 448 phone column at ALL widths — the root
 * layout no longer applies the clamp (it moved into the responsive shell for
 * the web waves). Login is a phone experience on every screen.
 */
export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <PhoneFrame>{children}</PhoneFrame>;
}
