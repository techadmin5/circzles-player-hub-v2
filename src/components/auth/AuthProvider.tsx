"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { dataMode, devAutoLoginEnabled, logPublicFrontendConfig } from "@/config/dataMode";
import { apiClient, ApiClientError } from "@/lib/apiClient";
import { usePlayerUiState } from "@/stores/playerUiState";
import type { AuthenticatedPlayerIdentity, PlayerProfile } from "@/types";
import { PlayerHubLoadingSkeleton } from "./PlayerHubLoadingSkeleton";

type AuthStatus = "checking" | "authenticated" | "unauthenticated" | "error";
type ProfileStatus = "idle" | "loading" | "ready" | "error";

interface AuthContextValue {
  status: AuthStatus;
  identity?: AuthenticatedPlayerIdentity;
  player?: PlayerProfile;
  profileStatus: ProfileStatus;
  acceptAuthentication: (player: PlayerProfile) => void;
  refresh: () => Promise<AuthenticatedPlayerIdentity | PlayerProfile | null>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>(dataMode === "mock" ? "authenticated" : "checking");
  const [identity, setIdentity] = useState<AuthenticatedPlayerIdentity>();
  const [player, setPlayer] = useState<PlayerProfile>();
  const [profileStatus, setProfileStatus] = useState<ProfileStatus>("idle");
  const sessionRequestRef = useRef<Promise<AuthenticatedPlayerIdentity | PlayerProfile | null> | null>(null);
  const sessionAbortRef = useRef<AbortController | null>(null);
  const authGenerationRef = useRef(0);
  const profileRequestRef = useRef<Promise<PlayerProfile | null> | null>(null);
  const profileAbortRef = useRef<AbortController | null>(null);

  const acceptProfile = useCallback((profile: PlayerProfile) => {
    setIdentity(profile);
    setPlayer(profile);
    usePlayerUiState.getState().hydrate(profile);
    setProfileStatus("ready");
  }, []);

  const acceptAuthentication = useCallback((authenticatedPlayer: PlayerProfile) => {
    profileAbortRef.current?.abort();
    profileRequestRef.current = null;
    acceptProfile(authenticatedPlayer);
    setStatus("authenticated");
  }, [acceptProfile]);

  const hydrateProfile = useCallback(() => {
    if (dataMode === "mock") return Promise.resolve(null);
    if (profileRequestRef.current) return profileRequestRef.current;
    const controller = new AbortController();
    profileAbortRef.current = controller;
    setProfileStatus("loading");
    const profileRequest = apiClient.getMe(controller.signal)
      .then((profile) => {
        acceptProfile(profile);
        return profile;
      })
      .catch((error) => {
        if (!controller.signal.aborted) setProfileStatus("error");
        throw error;
      })
      .finally(() => {
        if (profileAbortRef.current === controller) {
          profileAbortRef.current = null;
          profileRequestRef.current = null;
        }
      });
    profileRequestRef.current = profileRequest;
    return profileRequest;
  }, [acceptProfile]);

  const refresh = useCallback(() => {
    if (dataMode === "mock") return Promise.resolve(null);
    if (sessionRequestRef.current) return sessionRequestRef.current;
    const generation = authGenerationRef.current;
    const controller = new AbortController();
    sessionAbortRef.current = controller;
    setStatus("checking");
    const sessionRequest = (async () => {
      try {
        const authenticatedIdentity = await apiClient.getSession(controller.signal);
        if (generation !== authGenerationRef.current) return null;
        profileAbortRef.current?.abort();
        profileRequestRef.current = null;
        setIdentity(authenticatedIdentity);
        setPlayer(undefined);
        usePlayerUiState.getState().clear();
        setStatus("authenticated");
        void hydrateProfile().catch(() => undefined);
        return authenticatedIdentity;
      } catch (error) {
        if (generation !== authGenerationRef.current) return null;
        if (error instanceof ApiClientError && error.status === 401) {
          profileAbortRef.current?.abort();
          profileRequestRef.current = null;
          if (devAutoLoginEnabled) {
            try {
              const authenticatedPlayer = await apiClient.devLogin();
              acceptAuthentication(authenticatedPlayer);
              return authenticatedPlayer;
            } catch {
              console.error("[CircZles dev auth] Automatic development login failed.");
            }
          }
          setIdentity(undefined);
          setPlayer(undefined);
          setProfileStatus("idle");
          usePlayerUiState.getState().clear();
          setStatus("unauthenticated");
          return null;
        }
        setStatus("error");
        throw error;
      } finally {
        if (sessionAbortRef.current === controller) sessionAbortRef.current = null;
        sessionRequestRef.current = null;
      }
    })();
    sessionRequestRef.current = sessionRequest;
    return sessionRequest;
  }, [acceptAuthentication, hydrateProfile]);

  const logout = useCallback(async () => {
    authGenerationRef.current += 1;
    sessionAbortRef.current?.abort();
    sessionAbortRef.current = null;
    sessionRequestRef.current = null;
    profileAbortRef.current?.abort();
    profileRequestRef.current = null;
    setIdentity(undefined);
    setPlayer(undefined);
    setProfileStatus("idle");
    usePlayerUiState.getState().clear();
    setStatus("unauthenticated");
    if (dataMode === "api") await apiClient.logout();
  }, []);

  useEffect(() => {
    logPublicFrontendConfig();
    if (dataMode !== "api") return;
    const timeout = window.setTimeout(() => refresh().catch(() => undefined), 0);
    return () => window.clearTimeout(timeout);
  }, [refresh]);

  const value = useMemo(() => ({ status, identity, player, profileStatus, acceptAuthentication, refresh, logout }), [status, identity, player, profileStatus, acceptAuthentication, refresh, logout]);
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
