"use client";

import { useEffect, useState, type ReactNode } from "react";
import { devAutoLoginEnabled, logPublicFrontendConfig } from "@/config/dataMode";
import { apiClient, ApiClientError } from "@/lib/apiClient";

let bootstrapPromise: Promise<void> | undefined;

export function DevAuthBootstrap({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(!devAutoLoginEnabled);

  useEffect(() => {
    logPublicFrontendConfig();
    if (!devAutoLoginEnabled) return;

    let cancelled = false;
    runBootstrap().catch(() => undefined).finally(() => {
      if (!cancelled) setReady(true);
    });
    return () => { cancelled = true; };
  }, []);

  if (!ready) return <div className="min-h-dvh bg-[var(--cz-void)]" aria-busy="true" aria-label="Loading" />;
  return children;
}

function runBootstrap() {
  bootstrapPromise ??= ensureDevelopmentSession().catch((error: unknown) => {
    console.error("[CircZles dev auth] Automatic development login failed.");
    throw error;
  });
  return bootstrapPromise;
}

async function ensureDevelopmentSession() {
  try {
    await apiClient.getMe();
  } catch (error) {
    if (!(error instanceof ApiClientError) || error.status !== 401) throw error;
    await apiClient.devLogin();
  }
}
