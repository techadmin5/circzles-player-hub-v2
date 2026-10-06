"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { apiClient } from "@/lib/apiClient";

export function SecurityPanel() {
  const [security, setSecurity] = useState<{ email: string; hasPassword: boolean }>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { let active = true; apiClient.authSecurity().then((value) => { if (active) setSecurity(value); }).catch(() => { if (active) setMessage("Account security is temporarily unavailable."); }); return () => { active = false; }; }, []);
  async function request() {
    setBusy(true);
    try { await apiClient.requestSetPassword(); setMessage("Check your email for the password setup link. Open it in this browser while signed in."); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : "Could not send email."); }
    finally { setBusy(false); }
  }
  return <section className="cz-surface grid gap-3 p-5"><h2 className="cz-display text-base font-bold">Account security</h2>
    {security && <><p className="text-sm text-[var(--cz-text-secondary)]">{security.email}</p>{security.hasPassword ? <Link className="text-sm text-[var(--cz-aqua)]" href="/auth/forgot-password">Reset password</Link> : <><p className="text-sm">Add a password to use email login with your existing Player ID.</p><button className="cz-btn cz-btn-primary w-fit" disabled={busy} onClick={request}>Set password</button></>}</>}
    {message && <p role="status" className="text-sm">{message}</p>}
  </section>;
}
