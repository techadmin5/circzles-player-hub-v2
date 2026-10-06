"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { apiClient, ApiClientError } from "@/lib/apiClient";
import { parseWixAuthorizationCallback } from "@/lib/wixAuthCallback";

export function WixAuthorizationCallback() {
  const startedRef = useRef(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    let callback;
    try {
      callback = parseWixAuthorizationCallback({ hash: window.location.hash, search: window.location.search });
    } catch {
      queueMicrotask(() => setError("Authentication callback is invalid. Please start again."));
      return;
    }

    window.history.replaceState(null, "", window.location.pathname);
    apiClient.completeWixAuthorization(callback)
      .then(({ returnTo }) => window.location.replace(returnTo))
      .catch((caught) => {
        if (caught instanceof ApiClientError && caught.code === "WIX_AUTHORIZATION_DECLINED") {
          setError("Authentication was cancelled. Please try again when you are ready.");
          return;
        }
        setError("Authentication could not be completed. Please try again.");
      });
  }, []);

  if (error) {
    return (
      <div className="cz-surface p-6 text-center">
        <h1 className="cz-display text-xl font-bold">Could not enter Player Hub</h1>
        <p role="alert" className="mt-2 text-sm text-red-300">{error}</p>
        <Link href="/login?returnTo=%2Fhub" className="cz-btn cz-btn-primary mt-5">Return to login</Link>
      </div>
    );
  }

  return (
    <div className="cz-surface p-6 text-center" aria-busy="true">
      <h1 className="cz-display text-xl font-bold">Opening Player Hub</h1>
      <p className="mt-2 text-sm text-[var(--cz-text-secondary)]">Completing secure Wix authentication.</p>
    </div>
  );
}
