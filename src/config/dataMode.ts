export type DataMode = "mock" | "api";

const configuredDataMode = process.env.NEXT_PUBLIC_DATA_MODE;
const configuredApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
const configuredDevAutoLogin = process.env.NEXT_PUBLIC_DEV_AUTO_LOGIN;

const requestedDataMode: DataMode = configuredDataMode?.trim().toLowerCase() === "api" ? "api" : "mock";
if (process.env.NODE_ENV === "production" && requestedDataMode !== "api") {
  throw new Error("Production Player Hub requires NEXT_PUBLIC_DATA_MODE=api; mock identity is forbidden.");
}
export const dataMode: DataMode = requestedDataMode;
export const apiBaseUrl = configuredApiBaseUrl?.trim() || undefined;
const devAutoLoginRequested = ["true", "1", "yes"].includes(configuredDevAutoLogin?.trim().toLowerCase() ?? "");
export const devAutoLoginEnabled = process.env.NODE_ENV === "development"
  && dataMode === "api"
  && devAutoLoginRequested
  && isLocalApiBaseUrl(apiBaseUrl);
let publicConfigLogged = false;

if (dataMode === "api" && !apiBaseUrl) {
  throw new Error("NEXT_PUBLIC_API_BASE_URL is required when NEXT_PUBLIC_DATA_MODE resolves to api.");
}

export function logPublicFrontendConfig() {
  if (process.env.NODE_ENV !== "development" || publicConfigLogged) return;
  publicConfigLogged = true;
  console.info("[CircZles public config]", {
    dataMode,
    apiBaseUrlConfigured: Boolean(apiBaseUrl),
    devAutoLoginEnabled,
  });
}

function isLocalApiBaseUrl(value: string | undefined) {
  if (!value) return false;
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1";
  } catch {
    return false;
  }
}
