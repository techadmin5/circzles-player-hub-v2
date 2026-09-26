"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { LogIn } from "lucide-react";
import { apiClient, ApiClientError } from "@/lib/apiClient";
import { useAuth } from "./AuthProvider";
import { WixCaptcha } from "./WixCaptcha";

export function LoginForm({ returnTo }: { returnTo: string }) {
  const router = useRouter();
  const { status } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [captchaRequired, setCaptchaRequired] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string>();
  const [captchaResetKey, setCaptchaResetKey] = useState(0);

  useEffect(() => {
    if (status === "authenticated") router.replace(returnTo);
  }, [returnTo, router, status]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (captchaRequired && !captchaToken) {
      setError("Complete the security check before logging in.");
      return;
    }
    setBusy(true); setError("");
    const data = new FormData(event.currentTarget);
    try {
      const { authorizationUrl } = await apiClient.loginWithEmail(String(data.get("email")), String(data.get("password")), returnTo, captchaToken ? { token: captchaToken, type: "RECAPTCHA" } : undefined);
      window.location.assign(authorizationUrl);
    } catch (caught) {
      if (isCaptchaRequired(caught)) {
        setCaptchaRequired(true);
        setError("Please complete the security check.");
      } else if (isCaptchaInvalid(caught)) {
        setCaptchaRequired(true);
        setCaptchaToken(undefined);
        setCaptchaResetKey((value) => value + 1);
        setError("Security check expired. Please try again.");
      } else {
        setError(authMessage(caught));
      }
    } finally { setBusy(false); }
  }

  async function googleLogin() {
    setBusy(true); setError("");
    try {
      const { authorizationUrl } = await apiClient.getGoogleAuthorization(returnTo);
      window.location.assign(authorizationUrl);
    } catch (caught) {
      setError(authMessage(caught)); setBusy(false);
    }
  }

  return <div className="cz-surface mt-6 grid gap-4 p-5">
    <button type="button" className="cz-btn cz-btn-primary w-full" disabled={busy} onClick={googleLogin}>Continue with Google</button>
    <div className="flex items-center gap-3 text-xs text-[var(--cz-text-tertiary)]"><span className="h-px flex-1 bg-[var(--cz-hairline)]" />or use email<span className="h-px flex-1 bg-[var(--cz-hairline)]" /></div>
    <form className="grid gap-4" onSubmit={submit}>
      <label className="grid gap-1 text-sm"><span className="text-[var(--cz-text-secondary)]">Email</span><input name="email" required type="email" autoComplete="email" placeholder="player@example.com" className="min-h-11 rounded-xl border border-[var(--cz-hairline-strong)] bg-[var(--cz-inset)] px-3.5 text-sm outline-none focus:border-[var(--cz-aqua)]" /></label>
      <label className="grid gap-1 text-sm"><span className="text-[var(--cz-text-secondary)]">Password</span><input name="password" required minLength={8} maxLength={256} type="password" autoComplete="current-password" className="min-h-11 rounded-xl border border-[var(--cz-hairline-strong)] bg-[var(--cz-inset)] px-3.5 text-sm outline-none focus:border-[var(--cz-aqua)]" /></label>
      {captchaRequired && <WixCaptcha resetKey={captchaResetKey} onTokenChange={setCaptchaToken} onExpired={() => setError("Security check expired. Please try again.")} />}
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      <button className="cz-btn cz-btn-ghost w-full" disabled={busy} type="submit"><LogIn size={16} />{busy ? "Checking account" : "Log in"}</button>
    </form>
    <p className="text-center text-xs text-[var(--cz-text-tertiary)]">Email and social authentication are verified by the canonical CircZles identity provider. Player Hub never stores your password.</p>
    <p className="text-center text-sm text-[var(--cz-text-tertiary)]">New to CircZles? <Link href={`/signup?returnTo=${encodeURIComponent(returnTo)}`} className="text-[var(--cz-aqua)]">Create a profile</Link></p>
  </div>;
}

export function authMessage(error: unknown) {
  if (error instanceof ApiClientError) {
    if (error.code === "DIRECT_AUTH_PROVIDER_NOT_CONFIGURED") return "Direct account access is awaiting provider configuration.";
    if (error.code === "WIX_ACCOUNT_NOT_FOUND") return "Account not found. Please create a profile first.";
    if (error.code === "WIX_INCORRECT_PASSWORD") return "Incorrect password. Please try again.";
    if (error.code === "WIX_ACCOUNT_ALREADY_EXISTS") return "Account already exists. Please log in.";
    if (error.code === "WIX_INVALID_EMAIL") return "Enter a valid email address.";
    if (error.code === "WIX_CAPTCHA_REQUIRED") return "Please complete the security check.";
    if (error.code === "WIX_CAPTCHA_INVALID") return "Security check expired. Please try again.";
    if (error.status === 401) return "Email or password was not accepted.";
    return error.message;
  }
  return "Authentication could not be completed.";
}

function isCaptchaRequired(error: unknown) {
  return error instanceof ApiClientError && error.code === "WIX_CAPTCHA_REQUIRED";
}

function isCaptchaInvalid(error: unknown) {
  return error instanceof ApiClientError && error.code === "WIX_CAPTCHA_INVALID";
}
