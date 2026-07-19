import type { Metadata } from "next";
import { LegalPage, LegalSection } from "@/components/entry/legal-page";

export const metadata: Metadata = {
  title: "Terms · CUATRO",
  description: "Terms of service for Cuatro, the private iOS padel beta.",
};

export default function TermsPage() {
  return (
    <LegalPage title="Terms" updated="19 July 2026">
      <p className="text-ink-muted">
        Cuatro is a private beta. Things may change, break or move as we build it. These terms cover the
        basics; if you have a question, write to{" "}
        <a href="mailto:hello@padelcuatro.com" className="text-ink underline">
          hello@padelcuatro.com
        </a>
        .
      </p>

      <LegalSection heading="Using Cuatro">
        <p>
          You need to be at least 16 to use Cuatro. You're responsible for what you post, who you invite, and
          the results you record. Keep it honest, keep it civil, and use the report and block tools if another
          player doesn't.
        </p>
      </LegalSection>

      <LegalSection heading="A beta, not a finished product">
        <p>
          Features can change or be withdrawn, and the app may have bugs. Cuatro never touches your court
          payments, whether that's a Booked-on link to another platform or money tracked on the Tab between
          players.
        </p>
      </LegalSection>

      <LegalSection heading="Your account">
        <p>Keep your account to yourself. You can request deletion at any time from inside the app.</p>
      </LegalSection>

      <LegalSection heading="Changes">
        <p>We'll update this page if these terms change in any way that matters.</p>
      </LegalSection>
    </LegalPage>
  );
}
