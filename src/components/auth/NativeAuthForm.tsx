"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { apiClient } from "@/lib/apiClient";
import { useAuth } from "./AuthProvider";
import { AuthFormNotice, AuthNavigation, PasswordSetupIntroduction, type AuthMode } from "./AuthPresentation";

type Mode = AuthMode;
const inputStyle = "min-h-11 rounded-xl border border-[var(--cz-hairline-strong)] bg-[var(--cz-inset)] px-3.5 text-sm outline-none focus:border-[var(--cz-aqua)]";
const labels: Record<Mode, string> = { login: "Log in", signup: "Create account", verify: "Verify email", "forgot-password": "Send reset link", "reset-password": "Reset password", "set-password": "Add password" };
export function NativeAuthForm({ mode, returnTo = "/hub", initialError = "" }: { mode: Mode; returnTo?: string; initialError?: string }) {
  const router = useRouter();
  const { refresh } = useAuth();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(initialError);
  const [token, setToken] = useState("");
  const initialToken = useRef<string | null>(null);
  useEffect(() => {
    const value = initialToken.current ?? new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
    initialToken.current = value;
    if (value) window.history.replaceState(null, "", window.location.pathname + window.location.search);
    const timer = window.setTimeout(() => setToken(value), 0);
    return () => window.clearTimeout(timer);
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    const data = new FormData(event.currentTarget);
    try {
      if (mode === "signup") {
        await apiClient.nativeSignup(String(data.get("displayName")), String(data.get("email")), String(data.get("password")));
        setMessage("If eligible, a verification link has been sent. Check your email. If you already have a password, log in or reset it. Google users can sign in to set a password in Account security.");
      } else if (mode === "forgot-password") {
        await apiClient.forgotPassword(String(data.get("email")));
        setMessage("If an account with a password exists for this email, a reset link has been sent.");
      } else if (mode === "reset-password") {
        await apiClient.resetPassword(token, String(data.get("password")));
        setToken(""); setMessage("Password reset. Your previous sessions have been revoked. Log in with your new password.");
      } else {
        if (mode === "login") await apiClient.nativeLogin(String(data.get("email")), String(data.get("password")));
        else if (mode === "verify") await apiClient.nativeVerify(token);
        else await apiClient.setPassword(token, String(data.get("password")));
        const session = await refresh();
        if (!session) throw new Error("Your session could not be verified. Please log in.");
        router.replace(returnTo);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Authentication could not complete."); }
    finally { setBusy(false); }
  }
  async function google() {
    setBusy(true); setError("");
    try { window.location.assign((await apiClient.getGoogleAuthorization(returnTo)).authorizationUrl); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Google login could not start."); setBusy(false); }
  }
  const emailMode = mode === "login" || mode === "signup" || mode === "forgot-password";
  const passwordMode = mode === "login" || mode === "signup" || mode === "reset-password" || mode === "set-password";
  const tokenMode = mode === "verify" || mode === "reset-password" || mode === "set-password";
  return <div className="cz-surface mt-6 grid gap-4 p-5">
    {(mode === "login" || mode === "signup") && <button className="cz-btn cz-btn-primary w-full" disabled={busy} onClick={google}>Continue with Google</button>}
    {mode === "set-password" && <><PasswordSetupIntroduction /><p className="text-xs text-[var(--cz-text-tertiary)]">Keep the browser session that requested this email open. Your password will belong to the same Player ID.</p></>}
    <form className="grid gap-4" onSubmit={submit}>
      {mode === "signup" && <label className="grid gap-1 text-sm">Display name<input className={inputStyle} name="displayName" autoComplete="name" minLength={2} maxLength={80} required /></label>}
      {emailMode && <label className="grid gap-1 text-sm">Email<input className={inputStyle} name="email" type="email" autoComplete="email" maxLength={320} required /></label>}
      {passwordMode && <label className="grid gap-1 text-sm">{mode === "login" ? "Password" : "New password (at least 12 characters)"}<input className={inputStyle} name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={mode === "login" ? 1 : 12} maxLength={256} required /></label>}
      {tokenMode && !token && <p className="text-sm">Open the link in your email. If it expired, request a new one.</p>}
      <button className="cz-btn cz-btn-primary w-full" disabled={busy || (tokenMode && !token)}>{busy ? "Please wait..." : labels[mode]}</button>
    </form>
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    <AuthFormNotice mode={mode} message={message} />
    <AuthNavigation mode={mode} returnTo={returnTo} />
  </div>;
}
