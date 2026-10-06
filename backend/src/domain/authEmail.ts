import { AppError } from "./errors.js";

export interface AuthEmail { email: string; purpose: string; token: string; issuedAt: Date; expiresAt: Date }
export interface AuthMailer { send(message: AuthEmail): Promise<void> }
// Development mailbox is memory-only, never printed, and never enabled in production.
export class DevelopmentAuthMailer implements AuthMailer {
  readonly messages: AuthEmail[] = [];
  async send(message: AuthEmail) { this.messages.splice(0, Math.max(0, this.messages.length - 99)); this.messages.push(message); }
}

const copy = {
  VERIFY_EMAIL: {
    subject: "Verify your CircZles email", heading: "Verify your email", cta: "Verify email", path: "/auth/verify",
    body: "You're almost ready to use your CircZles Player Hub account. Verify your email address to finish setting up your account.",
    expiry: "This verification link", security: "If you didn't create a CircZles account, you can safely ignore this email.",
  },
  RESET_PASSWORD: {
    subject: "Reset your CircZles password", heading: "Reset your password", cta: "Reset password", path: "/auth/reset-password",
    body: "We received a request to reset the password for your CircZles Player Hub account.",
    expiry: "This reset link", security: "If you didn't request a password reset, you can safely ignore this email. Your current password will remain unchanged.",
  },
  SET_PASSWORD: {
    subject: "Add a password to your CircZles account", heading: "Add a password", cta: "Add password", path: "/auth/set-password",
    body: "You currently sign in to CircZles with Google. Add a password if you'd also like to sign in using your email address.",
    expiry: "This link", security: "If you didn't request this, you can safely ignore this email.",
  },
};
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

function renderAuthEmail(message: AuthEmail, frontendOrigin: string) {
  const content = copy[message.purpose as keyof typeof copy];
  if (!content) throw new AppError("AUTH_EMAIL_UNAVAILABLE", "Email delivery is temporarily unavailable.", 503);
  // Fragment keeps the challenge out of access logs and referrers.
  const url = new URL(content.path, frontendOrigin);
  url.hash = new URLSearchParams({ token: message.token }).toString();
  // Use the challenge's actual lifetime, independent of delivery latency or the wall clock.
  const minutes = (message.expiresAt.getTime() - message.issuedAt.getTime()) / 60_000;
  const duration = minutes % 60 === 0 ? `${minutes / 60} hour${minutes === 60 ? "" : "s"}` : `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const expiry = `${content.expiry} expires in ${duration}.`;
  const footer = "This is an automated security email from CircZles.";
  const text = ["CircZles", content.heading, content.body, `${content.cta}:\n${url}`, expiry, content.security, footer].join("\n\n");
  const safeUrl = escapeHtml(url.toString());
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(content.heading)}</title></head>
<body style="margin:0;padding:24px 12px;background-color:#f1f5f9;color:#0f172a;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" style="width:100%;border-collapse:collapse;"><tr><td align="center">
<table role="presentation" style="width:100%;max-width:560px;border-collapse:collapse;background-color:#ffffff;border:1px solid #cbd5e1;"><tr><td style="padding:32px 24px;">
<p style="margin:0 0 24px;font-size:20px;font-weight:bold;color:#115e59;">CircZles</p>
<h1 style="margin:0 0 16px;font-size:28px;line-height:1.25;">${escapeHtml(content.heading)}</h1>
<p style="margin:0 0 24px;font-size:16px;line-height:1.6;">${escapeHtml(content.body)}</p>
<table role="presentation" style="border-collapse:collapse;"><tr><td style="background-color:#115e59;border-radius:8px;"><a href="${safeUrl}" style="display:inline-block;padding:14px 22px;color:#ffffff;font-size:16px;font-weight:bold;text-decoration:none;">${escapeHtml(content.cta)}</a></td></tr></table>
<p style="margin:24px 0 8px;font-size:14px;line-height:1.5;color:#475569;">If the button doesn't work, open this link:</p>
<p style="margin:0 0 24px;font-size:14px;line-height:1.6;overflow-wrap:anywhere;word-break:break-all;"><a href="${safeUrl}" style="color:#115e59;text-decoration:underline;">${safeUrl}</a></p>
<p style="margin:0 0 16px;font-size:14px;line-height:1.6;">${escapeHtml(expiry)}</p>
<p style="margin:0;font-size:14px;line-height:1.6;color:#475569;">${escapeHtml(content.security)}</p>
<p style="margin:24px 0 0;padding-top:20px;border-top:1px solid #cbd5e1;font-size:12px;line-height:1.6;color:#475569;">${footer}</p>
</td></tr></table></td></tr></table></body></html>`;
  return { subject: content.subject, text, html };
}

export class ResendAuthMailer implements AuthMailer {
  constructor(private apiKey: string, private from: string, private frontendOrigin: string, private transport: typeof fetch = fetch) {}
  async send(message: AuthEmail) {
    const content = renderAuthEmail(message, this.frontendOrigin);
    let response;
    try {
      response = await this.transport("https://api.resend.com/emails", {
        method: "POST", signal: AbortSignal.timeout(10_000),
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: this.from, to: [message.email], ...content }),
      });
    } catch { throw new AppError("AUTH_EMAIL_UNAVAILABLE", "Email delivery is temporarily unavailable.", 503); }
    if (!response.ok) throw new AppError("AUTH_EMAIL_UNAVAILABLE", "Email delivery is temporarily unavailable.", 503);
  }
}
