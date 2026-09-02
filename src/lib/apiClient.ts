import type { PlayerProfile } from "@/types";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL;

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

export const apiClient = {
  getMe: () => request<PlayerProfile>("/api/me"),
};
