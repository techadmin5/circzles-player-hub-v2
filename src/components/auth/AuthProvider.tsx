"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { dataMode, devAutoLoginEnabled, logPublicFrontendConfig } from "@/config/dataMode";
import { apiClient, ApiClientError } from "@/lib/apiClient";
import { usePlayerUiState } from "@/stores/playerUiState";
import type { PlayerProfile } from "@/types";
import { PlayerHubLoadingSkeleton } from "./PlayerHubLoadingSkeleton";

type AuthStatus = "checking" | "authenticated" | "unauthenticated" | "error";

interface AuthContextValue {
  status: AuthStatus;
  player?: PlayerProfile;
  acceptAuthentication: (player: PlayerProfile) => void;
  refresh: () => Promise<PlayerProfile | null>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>(dataMode === "mock" ? "authenticated" : "checking");
  const [player, setPlayer] = useState<PlayerProfile>();
  const sessionRequestRef = useRef<Promise<PlayerProfile | null> | null>(null);

  const acceptAuthentication = useCallback((authenticatedPlayer: PlayerProfile) => {
    setPlayer(authenticatedPlayer);
    usePlayerUiState.getState().hydrate(authenticatedPlayer);
    setStatus("authenticated");
  }, []);

  const refresh = useCallback(() => {
    if (dataMode === "mock") return Promise.resolve(null);
    if (sessionRequestRef.current) return sessionRequestRef.current;
    setStatus("checking");
    const sessionRequest = (async () => {
      try {
        const authenticatedPlayer = await apiClient.getSession();
        acceptAuthentication(authenticatedPlayer);
        return authenticatedPlayer;
      } catch (error) {
        if (error instanceof ApiClientError && error.status === 401) {
          if (devAutoLoginEnabled) {
            try {
              const authenticatedPlayer = await apiClient.devLogin();
              acceptAuthentication(authenticatedPlayer);
              return authenticatedPlayer;
            } catch {
              console.error("[CircZles dev auth] Automatic development login failed.");
            }
          }
          setPlayer(undefined);
          usePlayerUiState.getState().clear();
          setStatus("unauthenticated");
          return null;
        }
        setStatus("error");
        throw error;
      } finally {
        sessionRequestRef.current = null;
      }
    })();
    sessionRequestRef.current = sessionRequest;
    return sessionRequest;
  }, [acceptAuthentication]);

  const logout = useCallback(async () => {
    if (dataMode === "api") await apiClient.logout();
    setPlayer(undefined);
    usePlayerUiState.getState().clear();
    setStatus("unauthenticated");
  }, []);

  useEffect(() => {
    logPublicFrontendConfig();
    if (dataMode !== "api") return;
    const timeout = window.setTimeout(() => refresh().catch(() => undefined), 0);
    return () => window.clearTimeout(timeout);
  }, [refresh]);

  const value = useMemo(() => ({ status, player, acceptAuthentication, refresh, logout }), [status, player, acceptAuthentication, refresh, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider.");
  return context;
}

export function AuthenticatedRoute({ children }: { children: ReactNode }) {
  const { status, refresh } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const redirectedPathRef = useRef<string | null>(null);

  useEffect(() => {
    if (status !== "unauthenticated") {
      redirectedPathRef.current = null;
      return;
    }
    if (redirectedPathRef.current === pathname) return;
    redirectedPathRef.current = pathname;
    router.replace(`/login?returnTo=${encodeURIComponent(pathname)}`);
  }, [pathname, router, status]);

  if (dataMode === "mock") return children;
  if (status === "authenticated") return children;
  if (status === "error") {
    return <div className="grid min-h-dvh place-items-center bg-[var(--cz-void)] px-4"><div className="cz-surface max-w-md p-6 text-center"><h1 className="cz-display text-xl font-bold">Session unavailable</h1><p className="mt-2 text-sm text-[var(--cz-text-secondary)]">The Player Hub could not verify your session.</p><button className="cz-btn cz-btn-primary mt-5" onClick={() => refresh().catch(() => undefined)}>Try again</button></div></div>;
  }
  return <PlayerHubLoadingSkeleton />;
}
