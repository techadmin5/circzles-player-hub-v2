import { AppError } from "./errors.js";

export interface AuthEmail { email: string; purpose: string; token: string; expiresAt: Date }
export interface AuthMailer { send(message: AuthEmail): Promise<void> }
// Development mailbox is memory-only, never printed, and never enabled in production.
export class DevelopmentAuthMailer implements AuthMailer {
  readonly messages: AuthEmail[] = [];
  async send(message: AuthEmail) { this.messages.splice(0, Math.max(0, this.messages.length - 99)); this.messages.push(message); }
}
export class ResendAuthMailer implements AuthMailer {
  constructor(private apiKey: string, private from: string, private frontendOrigin: string, private transport: typeof fetch = fetch) {}
  async send(message: AuthEmail) {
    const path = message.purpose === "VERIFY_EMAIL" ? "/auth/verify" : message.purpose === "SET_PASSWORD" ? "/auth/set-password" : "/auth/reset-password";
    // Fragment keeps the challenge out of access logs and referrers.
    const url = new URL(path, this.frontendOrigin); url.hash = new URLSearchParams({ token: message.token }).toString();
    let response;
    try {
      response = await this.transport("https://api.resend.com/emails", {
        method: "POST", signal: AbortSignal.timeout(10_000),
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: this.from, to: [message.email], subject: message.purpose === "VERIFY_EMAIL" ? "Verify your CircZles email" : "Secure your CircZles account", text: `Open this link to continue: ${url}\nIt expires at ${message.expiresAt.toISOString()}. If you did not request this, ignore this email.` }),
      });
    } catch { throw new AppError("AUTH_EMAIL_UNAVAILABLE", "Email delivery is temporarily unavailable.", 503); }
    if (!response.ok) throw new AppError("AUTH_EMAIL_UNAVAILABLE", "Email delivery is temporarily unavailable.", 503);
  }
}
