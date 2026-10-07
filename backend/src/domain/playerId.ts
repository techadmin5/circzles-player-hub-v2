// Keep in sync with circzles_player_id_prefix() in migration 0021.
export function sanitizePlayerEmailPrefix(email?: string | null) {
  const normalized = email?.trim() ?? "";
  if (!/^[^@\s]+@[^@\s]+$/.test(normalized)) return "player";
  const prefix = normalized.split("@")[0].replace(/[^A-Za-z0-9]+/g, "_").toLowerCase().replace(/^_+|_+$/g, "").slice(0, 64).replace(/_+$/g, "");
  return prefix || "player";
}

export function generatePublicPlayerId(email: string | null | undefined, playerNumber: bigint) {
  if (playerNumber < 1n || playerNumber > 9223372036854775807n) throw new RangeError("Player number must be a positive PostgreSQL bigint.");
  return `${sanitizePlayerEmailPrefix(email)}_${playerNumber.toString().padStart(3, "0")}`;
}

// Legacy IDs are accepted for lookup during rollout; they do not alias migrated IDs.
export const publicPlayerIdPattern = /^(?:[a-z0-9]+(?:_[a-z0-9]+)*_(?:00[1-9]|0[1-9][0-9]|[1-9][0-9]{2,18})|CZ-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6})$/;
