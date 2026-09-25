const DEFAULT_AUTH_RETURN_TO = "/hub";

export function safeAuthReturnTo(value?: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return DEFAULT_AUTH_RETURN_TO;
  }

  try {
    const parsed = new URL(value, "https://player-hub.circzles.local");
    if (parsed.origin !== "https://player-hub.circzles.local") return DEFAULT_AUTH_RETURN_TO;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return DEFAULT_AUTH_RETURN_TO;
  }
}
