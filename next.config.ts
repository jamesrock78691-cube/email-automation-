import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      // Gmail-friendly image URL: /p/<id>.png → tracking API
      { source: "/p/:id.png", destination: "/api/track/:id" },
      { source: "/p/:id.gif", destination: "/api/track/:id" },
    ];
  },
};

export default nextConfig;
