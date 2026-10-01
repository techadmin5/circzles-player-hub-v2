"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiClient } from "@/lib/apiClient";
import { handoffFragmentFreeUrl, readHandoffFromHash } from "@/lib/handoffFragment";
import { useAuth } from "./AuthProvider";
import { authMessage } from "./LoginForm";

export function HandoffExchange() {
  const router = useRouter();
  const { acceptAuthentication } = useAuth();
  const [error, setError] = useState("");
  // The handoff is single-use. React Strict Mode (development) runs effects twice, and the fragment is
  // removed on the first run, so the guard prevents the second run from reporting a false "missing" error.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    const token = readHandoffFromHash(window.location.hash);
    window.history.replaceState(null, "", handoffFragmentFreeUrl(window.location.pathname));
    if (!token) { queueMicrotask(() => setError("Authentication handoff is missing.")); return; }
    started.current = true;
    apiClient.exchangeAuthHandoff(token).then((player) => {
      acceptAuthentication(player);
      router.replace("/hub");
    }).catch((caught) => setError(authMessage(caught)));
  }, [acceptAuthentication, router]);

  if (error) return <div className="cz-surface p-6 text-center"><h1 className="cz-display text-xl font-bold">Could not enter Player Hub</h1><p role="alert" className="mt-2 text-sm text-red-300">{error}</p><Link href="/login" className="cz-btn cz-btn-primary mt-5">Go to login</Link></div>;
  return <div className="cz-surface p-6 text-center" aria-busy="true"><h1 className="cz-display text-xl font-bold">Opening Player Hub</h1><p className="mt-2 text-sm text-[var(--cz-text-secondary)]">Verifying your secure CircZles handoff.</p></div>;
}
