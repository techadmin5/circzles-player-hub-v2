"use client";

import { useEffect, useState } from "react";
import { PlayerLobbyHeader } from "@/components/player/PlayerLobbyHeader";
import { apiClient, ApiClientError } from "@/lib/apiClient";
import type { PlayerProfile } from "@/types";

interface AuthenticatedIdentityProps {
  fallbackPlayer: PlayerProfile;
  mode: "mock" | "api";
}

export function AuthenticatedIdentity({ fallbackPlayer, mode }: AuthenticatedIdentityProps) {
  const [player, setPlayer] = useState<PlayerProfile>(fallbackPlayer);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(mode === "api");

  async function loadMe(options: { showLoading?: boolean } = {}) {
    if (mode !== "api") return;
    if (options.showLoading) setLoading(true);
    setError(null);
    try {
      setPlayer(await apiClient.getMe());
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not load authenticated player.");
    } finally {
      setLoading(false);
    }
  }

  async function devLogin() {
    setError(null);
    try {
      const loggedIn = await apiClient.devLogin();
      setPlayer(loggedIn);
      await loadMe({ showLoading: true });
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Development login failed.");
    }
  }

  useEffect(() => {
    if (mode !== "api") return;
    let cancelled = false;
    async function loadInitialIdentity() {
      try {
        const authenticatedPlayer = await apiClient.getMe();
        if (!cancelled) {
          setPlayer(authenticatedPlayer);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiClientError ? err.message : "Could not load authenticated player.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadInitialIdentity();
    return () => {
      cancelled = true;
    };
  }, [mode]);

  return <section className="grid gap-3">
    <PlayerLobbyHeader player={player} showDebug={mode === "api" && process.env.NODE_ENV !== "production"} />
    {mode === "api" && <div className="game-card flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
      <div>
        <p className="text-sm font-semibold text-[var(--cyan)]">{loading ? "Checking authenticated session" : "Authenticated identity"}</p>
        <p className="text-sm text-[var(--text-secondary)]">Browser session cookie checked with GET /api/me.</p>
        {error && <p className="mt-2 text-sm text-red-200">{error}</p>}
      </div>
      {process.env.NODE_ENV !== "production" && <button className="btn btn-primary" onClick={devLogin}>Development Login</button>}
    </div>}
  </section>;
}
