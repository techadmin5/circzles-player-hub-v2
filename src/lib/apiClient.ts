import type { ApiMissionDto, ApiStoreCatalogItem, AuthenticatedPlayerIdentity, EquipmentSlot, InventoryResponse, LeaderboardCatalog, LeaderboardResponse, Mission, MissionClaimResult, PlayerProfile, PlayerPuzzle, PublicPlayerProfile, Puzzle, RenameDisplayNameResult, RewardWheelResult, RewardWheelStatus, SignedVideoUpload, StorePurchaseResult, Submission } from "@/types";
import { apiBaseUrl } from "@/config/dataMode";

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
  if (!apiBaseUrl) throw new ApiClientError("API_BASE_URL_MISSING", "NEXT_PUBLIC_API_BASE_URL is not configured.", 500);
  const response = await fetch(`${apiBaseUrl}${path}`, {
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

async function requestSession<T>(): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 30_000);
  try {
    return await request<T>("/api/auth/session", { signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiClientError("SESSION_CHECK_TIMEOUT", "Session verification took too long. Please try again.", 408);
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

function adaptSessionIdentity(player: Partial<AuthenticatedPlayerIdentity> & Pick<AuthenticatedPlayerIdentity, "internalId" | "publicPlayerId" | "displayName">): AuthenticatedPlayerIdentity {
  return {
    internalId: player.internalId,
    publicPlayerId: player.publicPlayerId,
    displayName: player.displayName,
    avatar: player.avatar || "/brand/avatar.svg",
    country: player.country ?? "",
    state: player.state ?? "",
  };
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

function adaptCatalogPuzzle(puzzle: Puzzle): PlayerPuzzle {
  return {
    ...puzzle,
    status: "OWNED",
  };
}

export function adaptApiMission(mission: ApiMissionDto, now = new Date()): Mission {
  return {
    missionId: mission.missionId,
    title: mission.title,
    description: mission.description,
    category: mission.category,
    periodType: mission.periodType,
    periodKey: mission.periodKey,
    status: mission.status,
    progress: mission.progress,
    claimable: mission.claimable,
    startAt: mission.startsAt,
    endAt: mission.endsAt,
    timeRemaining: missionTimeRemaining(mission.endsAt, now),
    rewards: mission.rewards.map((reward) => ({
      type: reward.type === "SYNAPSE_POINTS" ? "Synapse Points" : "XP",
      label: reward.label,
      value: reward.amount,
    })),
  };
}

function missionTimeRemaining(endsAt: string | null, now: Date) {
  if (!endsAt) return "No expiry";
  const remainingMs = new Date(endsAt).getTime() - now.getTime();
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return "Ended";
  const minutes = Math.ceil(remainingMs / 60_000);
  if (minutes < 60) return `${minutes}m remaining`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m remaining`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h remaining`;
}

export const apiClient = {
  getMe: async (signal?: AbortSignal) => adaptPhase3aPlayer(await request<Partial<PlayerProfile> & Pick<PlayerProfile, "internalId" | "publicPlayerId" | "displayName">>("/api/me", { signal })),
  getSession: async () => adaptSessionIdentity(await requestSession<Partial<AuthenticatedPlayerIdentity> & Pick<AuthenticatedPlayerIdentity, "internalId" | "publicPlayerId" | "displayName">>()),
  exchangeAuthHandoff: async (token: string) => adaptPhase3aPlayer(await request<Partial<PlayerProfile> & Pick<PlayerProfile, "internalId" | "publicPlayerId" | "displayName">>("/api/auth/handoff/exchange", { method: "POST", body: JSON.stringify({ token }) })),
  loginWithEmail: async (email: string, password: string, returnTo = "/hub", captcha?: { token: string; type: "RECAPTCHA" | "INVISIBLE_RECAPTCHA" }) => request<{ authorizationUrl: string }>("/api/auth/direct/email/login", { method: "POST", body: JSON.stringify({ email, password, returnTo, captchaToken: captcha?.token, captchaType: captcha?.type }) }),
  startEmailSignup: async (displayName: string, email: string, password: string, captcha?: { token: string; type: "RECAPTCHA" | "INVISIBLE_RECAPTCHA" }) => request<{ challengeId: string; expiresAt?: string }>("/api/auth/direct/email/signup", { method: "POST", body: JSON.stringify({ displayName, email, password, captchaToken: captcha?.token, captchaType: captcha?.type }) }),
  verifyEmailSignup: async (challengeId: string, code: string, returnTo = "/hub") => request<{ authorizationUrl: string }>("/api/auth/direct/email/verify", { method: "POST", body: JSON.stringify({ challengeId, code, returnTo }) }),
  getGoogleAuthorization: async (returnTo = "/hub") => request<{ authorizationUrl: string }>(`/api/auth/direct/google/start?returnTo=${encodeURIComponent(returnTo)}`),
  logout: async () => request<{ ok: true }>("/api/auth/logout", { method: "POST", body: JSON.stringify({}) }),
  devLogin: async () => adaptPhase3aPlayer(await request<Partial<PlayerProfile> & Pick<PlayerProfile, "internalId" | "publicPlayerId" | "displayName">>("/api/dev/login", {
    method: "POST",
    body: JSON.stringify({}),
  })),
  getOwnedPuzzles: async () => request<PlayerPuzzle[]>("/api/me/puzzles"),
  getPuzzle: async (puzzleId: string) => adaptCatalogPuzzle(await request<Puzzle>(`/api/puzzles/${encodeURIComponent(puzzleId)}`)),
  claimPuzzleByCode: async (code: string) => request<{ success: true; puzzle: PlayerPuzzle }>("/api/puzzles/claim", {
    method: "POST",
    body: JSON.stringify({ code }),
  }),
  signVideoUpload: async (input: { filename: string; mimeType: string; sizeBytes: number }) => request<SignedVideoUpload>("/api/uploads/videos/signed-url", { method: "POST", body: JSON.stringify(input) }),
  completeVideoUpload: async (videoUploadId: string) => request<{ videoUploadId: string; status: "COMPLETE" }>(`/api/uploads/videos/${encodeURIComponent(videoUploadId)}/complete`, { method: "POST", body: JSON.stringify({}) }),
  getSubmissions: async () => request<Submission[]>("/api/submissions"),
  getSubmission: async (submissionId: string) => request<Submission>(`/api/submissions/${encodeURIComponent(submissionId)}`),
  createSubmission: async (input: { playerPuzzleId: string; completionTimeMs: number; videoUploadId: string }, idempotencyKey: string) => request<Submission>("/api/submissions", { method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify(input) }),
  getLeaderboardCatalog: async (signal?: AbortSignal) => request<LeaderboardCatalog>("/api/leaderboards/catalog", { signal }),
  getLeaderboard: async (puzzleId: string, signal?: AbortSignal) => request<LeaderboardResponse>(`/api/leaderboards?puzzleId=${encodeURIComponent(puzzleId)}`, { signal }),
  getPublicPlayerProfile: async (publicPlayerId: string, signal?: AbortSignal) => request<PublicPlayerProfile>(`/api/players/${encodeURIComponent(publicPlayerId)}/public-profile`, { signal }),
  getMissions: async (signal?: AbortSignal) => (await request<{ missions: ApiMissionDto[] }>("/api/missions", { signal })).missions.map((mission) => adaptApiMission(mission)),
  claimMission: async (missionId: string, idempotencyKey: string) => request<MissionClaimResult>(`/api/missions/${encodeURIComponent(missionId)}/claim`, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({}),
  }),
  getStoreCatalog: async (signal?: AbortSignal) => (await request<{ items: ApiStoreCatalogItem[] }>("/api/rewards/store", { signal })).items,
  purchaseStoreListing: async (listingId: string, idempotencyKey: string) => request<StorePurchaseResult>(`/api/rewards/store/${encodeURIComponent(listingId)}/purchase`, { method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify({}) }),
  getInventory: async (signal?: AbortSignal) => request<InventoryResponse>("/api/me/inventory", { signal }),
  equipInventoryItem: async (inventoryItemId: string, slot: EquipmentSlot) => request<InventoryResponse>(`/api/me/inventory/${encodeURIComponent(inventoryItemId)}/equip`, { method: "POST", body: JSON.stringify({ slot }) }),
  unequipSlot: async (slot: EquipmentSlot) => request<InventoryResponse>(`/api/me/equipment/${encodeURIComponent(slot)}`, { method: "DELETE" }),
  renameDisplayName: async (inventoryItemId: string, displayName: string, idempotencyKey: string) => request<RenameDisplayNameResult>("/api/me/display-name", { method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify({ inventoryItemId, displayName }) }),
  getRewardWheel: async (signal?: AbortSignal) => request<RewardWheelStatus>("/api/wheel", { signal }),
  spinRewardWheel: async (idempotencyKey: string) => request<RewardWheelResult>("/api/wheel/spin", { method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify({}) }),
};

export function uploadVideoDirectly(signed: SignedVideoUpload, file: File, onProgress: (percent: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const form = new FormData();
    form.set("file", file);
    form.set("api_key", signed.fields.apiKey);
    form.set("timestamp", String(signed.fields.timestamp));
    form.set("public_id", signed.fields.publicId);
    form.set("signature", signed.fields.signature);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", signed.uploadUrl);
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100)); };
    xhr.onerror = () => reject(new ApiClientError("VIDEO_UPLOAD_NETWORK_ERROR", "Video upload failed.", 0));
    xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new ApiClientError("VIDEO_UPLOAD_FAILED", "Video upload failed.", xhr.status));
    xhr.send(form);
  });
}
