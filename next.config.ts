import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: false,
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
