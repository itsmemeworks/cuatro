/**
 * Mailer interface for the magic-link flow. Dev implementation logs the
 * link to the console; production sends real email.
 */
export interface Mailer {
  sendMagicLink(email: string, url: string): Promise<void>;
}

class ConsoleMailer implements Mailer {
  async sendMagicLink(email: string, url: string): Promise<void> {
    console.log(
      `\n[cuatro] magic link for ${email}\n  ${url}\n  (dev mode: no email sent, check console)\n`
    );
  }
}

// TODO(production): swap for a real provider (Postmark/Resend/SES), reading
// its API key from env. Keep the Mailer interface so callers don't change.
class ProductionMailer implements Mailer {
  async sendMagicLink(_email: string, _url: string): Promise<void> {
    throw new Error("ProductionMailer not implemented yet — set MAILER=console or add a provider");
  }
}

export function getMailer(): Mailer {
  return process.env.MAILER === "production" ? new ProductionMailer() : new ConsoleMailer();
}
