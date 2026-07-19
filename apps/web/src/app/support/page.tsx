import type { Metadata } from "next";
import { LegalPage, LegalSection } from "@/components/entry/legal-page";

export const metadata: Metadata = {
  title: "Support · CUATRO",
  description: "Get help with Cuatro, the private iOS padel beta.",
};

export default function SupportPage() {
  return (
    <LegalPage title="Support" updated="19 July 2026">
      <p className="text-ink-muted">
        Cuatro is a small, private beta, so support is a real person reading real email. Write to{" "}
        <a href="mailto:hello@padelcuatro.com" className="text-ink underline">
          hello@padelcuatro.com
        </a>{" "}
        and we'll get back to you.
      </p>

      <LegalSection heading="What to write in about">
        <p>
          Trouble signing in, a bug you've hit, a question about a Circle or a result, a safety concern about
          another player, or a request to delete your account or your data.
        </p>
      </LegalSection>

      <LegalSection heading="Reporting a player">
        <p>
          You can report or block a player from inside the app on their profile. If it needs more than that,
          tell us at the address above and we'll follow up.
        </p>
      </LegalSection>

      <LegalSection heading="Not on the beta yet">
        <p>
          Cuatro is currently a private iOS beta in Newcastle upon Tyne. Write in and we'll let you know when
          a wider beta opens up.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
