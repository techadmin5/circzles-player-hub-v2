"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { MailCheck, UserPlus } from "lucide-react";
import { apiClient, ApiClientError } from "@/lib/apiClient";
import { useAuth } from "./AuthProvider";
import { authMessage } from "./LoginForm";
import { WixCaptcha } from "./WixCaptcha";

export function SignupForm({ returnTo = "/hub" }: { returnTo?: string }) {
  const router = useRouter();
  const { status } = useAuth();
  const [challengeId, setChallengeId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [captchaRequired, setCaptchaRequired] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string>();
  const [captchaResetKey, setCaptchaResetKey] = useState(0);

  useEffect(() => { if (status === "authenticated") router.replace(returnTo); }, [returnTo, router, status]);

  async function startSignup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (captchaRequired && !captchaToken) {
      setError("Complete the security check before creating your account.");
      return;
    }
    setBusy(true); setError("");
    const data = new FormData(event.currentTarget);
    try {
      const challenge = await apiClient.startEmailSignup(String(data.get("displayName")), String(data.get("email")), String(data.get("password")), captchaToken ? { token: captchaToken, type: "RECAPTCHA" } : undefined);
      setChallengeId(challenge.challengeId);
    } catch (caught) {
      if (caught instanceof ApiClientError && caught.code === "WIX_CAPTCHA_REQUIRED") {
        setCaptchaRequired(true);
        setCaptchaToken(undefined);
        setCaptchaResetKey((value) => value + 1);
        setError("Complete the security check, then try creating your account again.");
      } else {
        setError(authMessage(caught));
      }
    }
    finally { setBusy(false); }
  }

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!challengeId) return;
    setBusy(true); setError("");
    const data = new FormData(event.currentTarget);
    try {
      const { authorizationUrl } = await apiClient.verifyEmailSignup(challengeId, String(data.get("code")), returnTo);
      window.location.assign(authorizationUrl);
    } catch (caught) { setError(authMessage(caught)); }
    finally { setBusy(false); }
  }

  async function googleSignup() {
    setBusy(true); setError("");
    try { window.location.assign((await apiClient.getGoogleAuthorization(returnTo)).authorizationUrl); }
    catch (caught) { setError(authMessage(caught)); setBusy(false); }
  }

  return <div className="cz-surface mt-6 grid gap-4 p-5">
    {!challengeId ? <>
      <button type="button" className="cz-btn cz-btn-primary w-full" disabled={busy} onClick={googleSignup}>Continue with Google</button>
      <div className="flex items-center gap-3 text-xs text-[var(--cz-text-tertiary)]"><span className="h-px flex-1 bg-[var(--cz-hairline)]" />or use email<span className="h-px flex-1 bg-[var(--cz-hairline)]" /></div>
      <form className="grid gap-4" onSubmit={startSignup}>
        <label className="grid gap-1 text-sm"><span className="text-[var(--cz-text-secondary)]">Name</span><input name="displayName" required minLength={2} maxLength={80} autoComplete="name" className="min-h-11 rounded-xl border border-[var(--cz-hairline-strong)] bg-[var(--cz-inset)] px-3.5 text-sm outline-none focus:border-[var(--cz-aqua)]" /></label>
        <label className="grid gap-1 text-sm"><span className="text-[var(--cz-text-secondary)]">Email</span><input name="email" required type="email" autoComplete="email" className="min-h-11 rounded-xl border border-[var(--cz-hairline-strong)] bg-[var(--cz-inset)] px-3.5 text-sm outline-none focus:border-[var(--cz-aqua)]" /></label>
        <label className="grid gap-1 text-sm"><span className="text-[var(--cz-text-secondary)]">Password</span><input name="password" required minLength={8} maxLength={256} type="password" autoComplete="new-password" className="min-h-11 rounded-xl border border-[var(--cz-hairline-strong)] bg-[var(--cz-inset)] px-3.5 text-sm outline-none focus:border-[var(--cz-aqua)]" /></label>
        {captchaRequired && <WixCaptcha resetKey={captchaResetKey} onTokenChange={setCaptchaToken} />}
        <button className="cz-btn cz-btn-ghost w-full" disabled={busy} type="submit"><UserPlus size={16} />{busy ? "Creating verification" : "Create account"}</button>
      </form>
    </> : <form className="grid gap-4" onSubmit={verify}>
      <div><h2 className="cz-display text-lg font-bold">Verify your email</h2><p className="mt-1 text-sm text-[var(--cz-text-secondary)]">Enter the one-time signup code sent by the identity provider.</p></div>
      <label className="grid gap-1 text-sm"><span className="text-[var(--cz-text-secondary)]">Verification code</span><input name="code" required minLength={4} maxLength={12} inputMode="numeric" autoComplete="one-time-code" className="min-h-11 rounded-xl border border-[var(--cz-hairline-strong)] bg-[var(--cz-inset)] px-3.5 text-sm outline-none focus:border-[var(--cz-aqua)]" /></label>
      <button className="cz-btn cz-btn-primary w-full" disabled={busy} type="submit"><MailCheck size={16} />{busy ? "Verifying" : "Verify and continue"}</button>
    </form>}
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    <p className="text-center text-[0.68rem] text-[var(--cz-text-tertiary)]">Your password and one-time code remain provider-managed and are never stored by Player Hub.</p>
    <p className="text-center text-sm text-[var(--cz-text-tertiary)]">Already have an account? <Link href={`/login?returnTo=${encodeURIComponent(returnTo)}`} className="text-[var(--cz-aqua)]">Log in</Link></p>
  </div>;
}
