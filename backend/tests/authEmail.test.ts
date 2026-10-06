import { afterEach, describe, expect, it, vi } from "vitest";
import { DevelopmentAuthMailer, ResendAuthMailer, type AuthEmail } from "../src/domain/authEmail.js";

const issuedAt = new Date("2026-10-06T11:00:00.000Z");
const cases = [
  { purpose: "VERIFY_EMAIL", subject: "Verify your CircZles email", heading: "Verify your email", cta: "Verify email", path: "/auth/verify", minutes: 60, expiry: "This verification link expires in 1 hour.", security: "If you didn't create a CircZles account, you can safely ignore this email." },
  { purpose: "RESET_PASSWORD", subject: "Reset your CircZles password", heading: "Reset your password", cta: "Reset password", path: "/auth/reset-password", minutes: 15, expiry: "This reset link expires in 15 minutes.", security: "If you didn't request a password reset, you can safely ignore this email. Your current password will remain unchanged." },
  { purpose: "SET_PASSWORD", subject: "Add a password to your CircZles account", heading: "Add a password", cta: "Add password", path: "/auth/set-password", minutes: 15, expiry: "This link expires in 15 minutes.", security: "If you didn't request this, you can safely ignore this email." },
];
const message = (purpose = "VERIFY_EMAIL", minutes = 60): AuthEmail => ({ email: "player@example.test", purpose, token: "secret+token/&\"<", issuedAt, expiresAt: new Date(issuedAt.getTime() + minutes * 60_000) });
const htmlText = (html: string) => html.replace(/<[^>]*>/g, "").replaceAll("&#39;", "'");
afterEach(() => vi.restoreAllMocks());

describe("transactional auth email", () => {
  it.each(cases)("sends $purpose with purpose-specific HTML and plain text", async (content) => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id: "test-email" }));
    await new ResendAuthMailer("api-key", "Configured sender <security@example.test>", "https://hub.example.test", transport).send(message(content.purpose, content.minutes));
    const [endpoint, options] = transport.mock.calls[0];
    expect(endpoint).toBe("https://api.resend.com/emails");
    const body = JSON.parse(options!.body as string);
    expect(body.from).toBe("Configured sender <security@example.test>");
    expect(body.to).toEqual(["player@example.test"]);
    expect(body.subject).toBe(content.subject);
    const url = new URL(content.path, "https://hub.example.test");
    url.hash = new URLSearchParams({ token: message().token }).toString();
    expect(body.html).toContain(`<a href="${url}"`);
    expect(body.html).toContain(`>${url}</a>`);
    expect(body.html).toContain(`>${content.cta}</a>`);
    expect(body.text).toContain(`${content.cta}:\n${url}`);
    for (const rendered of [body.text, htmlText(body.html)]) {
      expect(rendered).toContain(content.heading);
      expect(rendered).toContain(content.expiry);
      expect(rendered).toContain(content.security);
      expect(rendered).toContain("This is an automated security email from CircZles.");
      expect(rendered).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:/);
      expect(rendered).not.toContain(message().token);
    }
    // Tokens occur only in the intended action URLs, including the visible fallback.
    expect(body.html.replaceAll(url.toString(), "")).not.toContain("secret");
    expect(body.text.replaceAll(url.toString(), "")).not.toContain("secret");
    expect(body.html).not.toMatch(/<(script|img|iframe)|\son\w+=|stylesheet/i);
    expect(body.html).toContain('lang="en"');
    expect(body.html).toContain("max-width:560px");
    expect(body.html).toContain("style=");
  });

  it.each(["success", "http-error", "transport-error"])("never logs tokens on %s", async (outcome) => {
    const logs = ["log", "info", "warn", "error", "debug"] as const;
    const spies = logs.map((method) => vi.spyOn(console, method).mockImplementation(() => {}));
    const transport = vi.fn<typeof fetch>();
    if (outcome === "transport-error") transport.mockRejectedValue(new Error(`provider error ${message().token}`));
    else transport.mockResolvedValue(new Response(null, { status: outcome === "success" ? 200 : 500 }));
    const result = new ResendAuthMailer("api-key", "sender", "https://hub.example.test", transport).send(message());
    if (outcome === "success") await result;
    else await expect(result).rejects.toMatchObject({ code: "AUTH_EMAIL_UNAVAILABLE", message: "Email delivery is temporarily unavailable.", statusCode: 503 });
    const mailbox = new DevelopmentAuthMailer(); await mailbox.send(message());
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});
