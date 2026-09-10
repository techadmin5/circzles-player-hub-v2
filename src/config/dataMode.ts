export type DataMode = "mock" | "api";

const configuredDataMode = process.env.NEXT_PUBLIC_DATA_MODE;
const configuredApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;

export const dataMode: DataMode = configuredDataMode?.trim().toLowerCase() === "api" ? "api" : "mock";
export const apiBaseUrl = configuredApiBaseUrl?.trim() || undefined;

if (dataMode === "api" && !apiBaseUrl) {
  throw new Error("NEXT_PUBLIC_API_BASE_URL is required when NEXT_PUBLIC_DATA_MODE resolves to api.");
}

export function logPublicFrontendConfig() {
  if (process.env.NODE_ENV !== "development") return;
  console.info("[CircZles public config]", {
    dataMode,
    apiBaseUrlConfigured: Boolean(apiBaseUrl),
  });
}
