"use client";

import { useEffect, useState, type ReactNode } from "react";
import { dataMode, devAutoLoginEnabled, logPublicFrontendConfig } from "@/config/dataMode";
import { apiClient, ApiClientError } from "@/lib/apiClient";
import { usePlayerUiState } from "@/stores/playerUiState";

let bootstrapPromise: Promise<void> | undefined;

export function DevAuthBootstrap({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(dataMode !== "api");

  useEffect(() => {
    logPublicFrontendConfig();
    if (dataMode !== "api") return;

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
    if (devAutoLoginEnabled) console.error("[CircZles dev auth] Automatic development login failed.");
    throw error;
  });
  return bootstrapPromise;
}

async function ensureDevelopmentSession() {
  try {
    usePlayerUiState.getState().hydrate(await apiClient.getMe());
  } catch (error) {
    if (!(error instanceof ApiClientError) || error.status !== 401) throw error;
    if (!devAutoLoginEnabled) return;
    usePlayerUiState.getState().hydrate(await apiClient.devLogin());
  }
}
