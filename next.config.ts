import type { NextConfig } from "next";

const configuredApiOrigin = process.env.PLAYER_HUB_API_ORIGIN?.trim()
  || process.env.NEXT_PUBLIC_API_BASE_URL?.trim();

function apiProxyOrigin() {
  if (!configuredApiOrigin) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("PLAYER_HUB_API_ORIGIN is required for the production API proxy.");
    }
    return undefined;
  }
  const url = new URL(configuredApiOrigin);
  if (!/^https?:$/.test(url.protocol) || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("PLAYER_HUB_API_ORIGIN must be an HTTP(S) origin without a path, query, or fragment.");
  }
  return url.origin;
}

const nextConfig: NextConfig = {
  typedRoutes: false,
  async rewrites() {
    const origin = apiProxyOrigin();
    return origin ? [{ source: "/api/:path*", destination: `${origin}/api/:path*` }] : [];
  },
  async headers() {
    return [{
      source: "/api/:path*",
      headers: [
        { key: "Cache-Control", value: "private, no-store, no-cache, max-age=0, must-revalidate" },
        { key: "Pragma", value: "no-cache" },
      ],
    }];
  },
};

export default nextConfig;
