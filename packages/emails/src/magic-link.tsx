import {
  Html,
  Head,
  Preview,
  Body,
  Container,
  Section,
  Text,
  Button,
  Hr,
} from "@react-email/components";
import * as React from "react";

/**
 * CUATRO magic-link email. Rendered to static HTML (see render.ts) that
 * Supabase's Go templating consumes: {{ .ConfirmationURL }} must survive
 * verbatim as both the button href and the fallback URL text.
 *
 * Brand rules (globals.css tokens, email-safe): warm cream ground #faf8f4,
 * near-black ink #191713, one coral action (#ff4d2e), facts in a monospace
 * stack. Archivo is not email-safe, so headings use a heavy system sans.
 * Everything is inline-styled and colours are explicit so dark-mode clients
 * don't repaint the card into something illegible.
 */

// The Supabase Go-template variable, kept as a literal so it renders verbatim.
const CONFIRMATION_URL = "{{ .ConfirmationURL }}";

const CREAM = "#faf8f4";
const CARD = "#ffffff";
const INK = "#191713";
const INK_MUTED = "#6b6559";
const CORAL = "#ff4d2e";
const HAIRLINE = "#e8e3da";

const SANS =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

export function MagicLinkEmail() {
  return (
    <Html lang="en">
      <Head />
      <Preview>Your sign-in link for CUATRO</Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={card}>
            <Text style={wordmark}>CUATRO</Text>

            <Text style={heading}>Here is your sign-in link.</Text>
            <Text style={paragraph}>
              You asked to sign in to CUATRO. Tap the button below and you are
              in. If you did not ask for this, you can ignore this email and
              nothing happens.
            </Text>

            <Section style={buttonWrap}>
              <Button href={CONFIRMATION_URL} style={button}>
                Sign in to CUATRO
              </Button>
            </Section>

            <Text style={meta}>
              This link expires soon and works once. Keep it to yourself.
            </Text>

            <Hr style={hr} />

            <Text style={fallbackLabel}>
              Button not working? Paste this into your browser.
            </Text>
            <Text style={fallbackUrl}>{CONFIRMATION_URL}</Text>
          </Section>

          <Text style={footer}>
            CUATRO. The app your padel four runs on.
          </Text>
          <Text style={footerLink}>padelcuatro.com</Text>
        </Container>
      </Body>
    </Html>
  );
}

export default MagicLinkEmail;

const body: React.CSSProperties = {
  backgroundColor: CREAM,
  margin: 0,
  padding: "24px 0",
  fontFamily: SANS,
  WebkitTextSizeAdjust: "100%",
};

const container: React.CSSProperties = {
  maxWidth: "480px",
  margin: "0 auto",
  padding: "0 16px",
};

const card: React.CSSProperties = {
  backgroundColor: CARD,
  border: `1px solid ${HAIRLINE}`,
  borderRadius: "20px",
  padding: "32px",
};

const wordmark: React.CSSProperties = {
  fontFamily: SANS,
  fontSize: "22px",
  fontWeight: 800,
  letterSpacing: "0.14em",
  color: INK,
  margin: "0 0 28px",
};

const heading: React.CSSProperties = {
  fontFamily: SANS,
  fontSize: "20px",
  fontWeight: 700,
  lineHeight: "28px",
  color: INK,
  margin: "0 0 12px",
};

const paragraph: React.CSSProperties = {
  fontFamily: SANS,
  fontSize: "15px",
  lineHeight: "24px",
  color: INK_MUTED,
  margin: "0 0 24px",
};

const buttonWrap: React.CSSProperties = {
  margin: "0 0 20px",
};

const button: React.CSSProperties = {
  backgroundColor: CORAL,
  color: "#ffffff",
  fontFamily: SANS,
  fontSize: "16px",
  fontWeight: 700,
  textDecoration: "none",
  borderRadius: "14px",
  padding: "14px 24px",
  display: "inline-block",
};

const meta: React.CSSProperties = {
  fontFamily: MONO,
  fontSize: "12px",
  lineHeight: "18px",
  color: INK_MUTED,
  margin: "0",
};

const hr: React.CSSProperties = {
  borderColor: HAIRLINE,
  margin: "24px 0",
};

const fallbackLabel: React.CSSProperties = {
  fontFamily: SANS,
  fontSize: "13px",
  lineHeight: "20px",
  color: INK_MUTED,
  margin: "0 0 8px",
};

const fallbackUrl: React.CSSProperties = {
  fontFamily: MONO,
  fontSize: "12px",
  lineHeight: "18px",
  color: CORAL,
  wordBreak: "break-all",
  margin: "0",
};

const footer: React.CSSProperties = {
  fontFamily: SANS,
  fontSize: "13px",
  lineHeight: "20px",
  color: INK_MUTED,
  textAlign: "center",
  margin: "24px 0 4px",
};

const footerLink: React.CSSProperties = {
  fontFamily: MONO,
  fontSize: "12px",
  color: INK_MUTED,
  textAlign: "center",
  margin: "0",
};
