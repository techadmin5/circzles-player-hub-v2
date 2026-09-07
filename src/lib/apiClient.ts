import type { PlayerProfile, PlayerPuzzle, Puzzle, SignedVideoUpload, Submission } from "@/types";

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

function adaptCatalogPuzzle(puzzle: Puzzle): PlayerPuzzle {
  return {
    ...puzzle,
    status: "OWNED",
  };
}

export const apiClient = {
  getMe: async () => adaptPhase3aPlayer(await request<Partial<PlayerProfile> & Pick<PlayerProfile, "internalId" | "publicPlayerId" | "displayName">>("/api/me")),
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
