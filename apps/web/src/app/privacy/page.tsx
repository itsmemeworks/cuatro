import type { Metadata } from "next";
import { LegalPage, LegalSection } from "@/components/entry/legal-page";

export const metadata: Metadata = {
  title: "Privacy · CUATRO",
  description: "What CUATRO collects, why, and who it's shared with.",
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy" updated="19 July 2026">
      <p className="text-ink-muted">
        Cuatro is a private iOS beta for organising padel. This page explains what we collect, why, and who
        it passes through on its way to you. If anything here is unclear, write to{" "}
        <a href="mailto:hello@padelcuatro.com" className="text-ink underline">
          hello@padelcuatro.com
        </a>
        .
      </p>

      <LegalSection heading="What we collect">
        <p>
          Your first name, email address and an optional avatar. An approximate patch, the area around your
          home court, used to show you nearby courts and players. It is never your exact location, and we
          never ask your device for it.
        </p>
        <p>
          The Circles you join, the games you organise or play, invitations, availability, chat messages and
          match results. A device token, used only to deliver push notifications through Apple's service.
          Safety reports you file and records of players you block.
        </p>
      </LegalSection>

      <LegalSection heading="Why we collect it">
        <p>
          To run the app: finding you a fourth, keeping your group's Circle, chat and history in one place,
          keeping a trustworthy record of results, and telling you when something needs your attention.
        </p>
      </LegalSection>

      <LegalSection heading="Who it passes through">
        <p>
          Supabase hosts our database, authentication and realtime updates. Resend delivers our transactional
          email (magic links, notifications). Apple's APNs delivers push notifications. None of them see more
          than they need to do that one job, and none of them are ad networks.
        </p>
      </LegalSection>

      <LegalSection heading="What we don't do">
        <p>We don't run advertising, and we don't track you across other apps or websites. We don't sell data, to anyone, ever.</p>
      </LegalSection>

      <LegalSection heading="Deleting your account">
        <p>You can request account deletion from inside the app, in Settings.</p>
      </LegalSection>
    </LegalPage>
  );
}
