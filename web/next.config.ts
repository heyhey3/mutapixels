import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Optional same-origin proxy for a temporary single-tunnel demo (or any
  // deployment where the API is not separately exposed). Leave unset for
  // Vercel/Render and Docker, where NEXT_PUBLIC_API_URL points at the API.
  async rewrites() {
    const target = process.env.API_PROXY_TARGET?.trim().replace(/\/$/, "");
    if (!target) return [];
    return [{ source: "/api/:path*", destination: `${target}/api/:path*` }];
  },
};

export default nextConfig;
