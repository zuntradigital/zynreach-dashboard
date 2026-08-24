import nodemailer, { type Transporter } from "nodemailer";

/**
 * Real transactional email via Hostinger SMTP — the invitation flow's
 * normal path, not a fallback. Configured entirely from env vars
 * (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM; optional
 * SMTP_SECURE — defaults to true for port 465's implicit TLS, false
 * otherwise). SMTP_USER authenticates the connection; SMTP_FROM is the
 * address shown as the sender (falls back to SMTP_USER if unset — they're
 * the same mailbox here). Outbound-send only — deliberately no IMAP/POP3
 * transport is configured anywhere in this module; nodemailer only ever
 * opens an SMTP connection to submit mail, never to read a mailbox.
 *
 * Delivery failure (missing credentials, auth error, rejected address) is
 * reported back to the caller rather than thrown — creating the invited
 * AdminUser row and issuing the token must never be undone just because
 * an email bounced; the Dashboard surfaces the failure and the invite
 * link so a Super Administrator can act on it (resend once the provider
 * is fixed, or relay the link directly as a last resort).
 */
export interface InvitationEmailInput {
  to: string;
  inviteUrl: string;
  expiresAt: Date;
}

export interface SendEmailResult {
  sent: boolean;
  reason?: string;
}

let cachedTransporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : undefined;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;
  if (!host || !port || !user || !pass) return null;

  const secure = process.env.SMTP_SECURE !== undefined ? process.env.SMTP_SECURE === "true" : port === 465;

  if (!cachedTransporter) {
    cachedTransporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
    });
  }
  return cachedTransporter;
}

function renderInvitationEmailHtml(inviteUrl: string, expiresAt: Date): string {
  const expiresLabel = expiresAt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; color: #171717;">
      <h1 style="font-size: 20px; margin: 0 0 16px;">You've been invited to ZynReach Admin Dashboard</h1>
      <p style="font-size: 14px; line-height: 1.6; color: #404040;">
        An administrator has invited you to access the ZynReach Admin Dashboard.
        Click the button below to accept the invitation and set up your account.
      </p>
      <p style="margin: 24px 0;">
        <a href="${inviteUrl}" style="display: inline-block; background: #1d4ed8; color: #ffffff; text-decoration: none; padding: 10px 20px; border-radius: 6px; font-size: 14px; font-weight: 600;">
          Accept Invitation
        </a>
      </p>
      <p style="font-size: 13px; color: #737373; line-height: 1.6;">
        This invitation link is single-use and expires on ${expiresLabel}.
        If the button above doesn't work, copy and paste this link into your browser:<br />
        <span style="word-break: break-all;">${inviteUrl}</span>
      </p>
      <p style="font-size: 13px; color: #a3a3a3; margin-top: 32px;">
        If you weren't expecting this invitation, you can safely ignore this email.
      </p>
    </div>
  `.trim();
}

export async function sendInvitationEmail(input: InvitationEmailInput): Promise<SendEmailResult> {
  const { to, inviteUrl, expiresAt } = input;
  const transporter = getTransporter();
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;

  if (!transporter || !from) {
    const missing = [
      !process.env.SMTP_HOST && "SMTP_HOST",
      !process.env.SMTP_PORT && "SMTP_PORT",
      !process.env.SMTP_USER && "SMTP_USER",
      !process.env.SMTP_PASSWORD && "SMTP_PASSWORD",
      !from && "SMTP_FROM",
    ]
      .filter((name): name is string => Boolean(name))
      .join(" / ");
    console.error(`[email:invitation] Not configured — missing ${missing}. Invite link for ${to}: ${inviteUrl}`);
    return { sent: false, reason: `Email provider is not configured (${missing} missing).` };
  }

  try {
    await transporter.sendMail({
      from: `"ZynReach Admin" <${from}>`,
      to,
      subject: "You've been invited to the ZynReach Admin Dashboard",
      html: renderInvitationEmailHtml(inviteUrl, expiresAt),
    });

    return { sent: true };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown email delivery error.";
    console.error(`[email:invitation] Failed to send to ${to}:`, reason);
    return { sent: false, reason };
  }
}
