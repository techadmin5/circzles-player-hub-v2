"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { apiClient } from "@/lib/apiClient";
import { AuthNotice, PasswordSetupIntroduction, passwordSetupSentMessage } from "./AuthPresentation";
import { AuthLoadingOverlay } from "./AuthLoadingOverlay";
import { emailLoadingSlides } from "./authLoadingSlides";
import { useAuthLoading } from "./useAuthLoading";

export function SecurityPanel() {
  const [security, setSecurity] = useState<{ email: string; hasPassword: boolean }>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const loading = useAuthLoading(emailLoadingSlides.length);
  const [emailSent, setEmailSent] = useState(false);
  useEffect(() => { let active = true; apiClient.authSecurity().then((value) => { if (active) setSecurity(value); }).catch(() => { if (active) setMessage("Account security is temporarily unavailable."); }); return () => { active = false; }; }, []);
  async function request() {
    if (busy || !loading.start()) return;
    setBusy(true); setEmailSent(false); setMessage("");
    try { await apiClient.requestSetPassword(); setEmailSent(true); setMessage(passwordSetupSentMessage); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : "Could not send email."); }
    finally { loading.finish(); setBusy(false); }
  }
  return <section className="cz-surface grid gap-3 p-5"><h2 className="cz-display text-base font-bold">Account security</h2>
    {security && <><p className="text-sm text-[var(--cz-text-secondary)]">{security.email}</p>{security.hasPassword ? <Link className="text-sm text-[var(--cz-aqua)]" href="/auth/forgot-password">Reset password</Link> : <><h3 className="font-semibold">Add a password</h3><PasswordSetupIntroduction /><button className="cz-btn cz-btn-primary w-fit" disabled={busy} onClick={request}>{busy ? "Please wait..." : "Add password"}</button></>}</>}
    <AuthNotice message={message} emailSent={emailSent} />
    {emailSent && <p className="text-xs text-[var(--cz-text-tertiary)]">Open the link in this browser while signed in.</p>}
    {loading.visible && <AuthLoadingOverlay slide={emailLoadingSlides[loading.slideIndex]} />}
  </section>;
}
