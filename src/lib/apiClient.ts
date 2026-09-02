import type { PlayerProfile } from "@/types";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL;
const phase3aDefaultStats: PlayerProfile["stats"] = {
  ownedPuzzles: 0,
  completed: 0,
  approvedAttempts: 0,
  personalBests: 0,
  podiums: 0,
  seasonRank: 0,
  longestStreak: 0,
};

export class ApiClientError extends Error {
  constructor(public code: string, message: string, public status: number, public details?: unknown, public requestId?: string) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!API_BASE_URL) throw new ApiClientError("API_BASE_URL_MISSING", "NEXT_PUBLIC_API_BASE_URL is not configured.", 500);
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiClientError(body.code ?? "API_ERROR", body.message ?? "API request failed.", response.status, body.details, body.requestId);
  }
  return response.json() as Promise<T>;
}

function adaptPhase3aPlayer(player: Partial<PlayerProfile> & Pick<PlayerProfile, "internalId" | "publicPlayerId" | "displayName">): PlayerProfile {
  return {
    internalId: player.internalId,
    publicPlayerId: player.publicPlayerId,
    displayName: player.displayName,
    avatar: player.avatar ?? "/brand/avatar.svg",
    country: player.country ?? "",
    state: player.state ?? "",
    progressionLevel: player.progressionLevel ?? 1,
    rank: player.rank ?? "Peasant",
    xp: player.xp ?? 0,
    xpNeeded: player.xpNeeded ?? 1200,
    synapsePoints: player.synapsePoints ?? 0,
    streak: player.streak ?? 0,
    equippedFrame: player.equippedFrame ?? "Starter Frame",
    badgeShowcase: player.badgeShowcase ?? [],
    stats: player.stats ?? phase3aDefaultStats,
  };
}

export const apiClient = {
  getMe: async () => adaptPhase3aPlayer(await request<Partial<PlayerProfile> & Pick<PlayerProfile, "internalId" | "publicPlayerId" | "displayName">>("/api/me")),
  devLogin: async () => adaptPhase3aPlayer(await request<Partial<PlayerProfile> & Pick<PlayerProfile, "internalId" | "publicPlayerId" | "displayName">>("/api/dev/login", {
    method: "POST",
    body: JSON.stringify({}),
  })),
};
