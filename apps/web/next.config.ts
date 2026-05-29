import type { NextConfig } from "next";

const hsts =
  process.env.FLEET_HSTS === "1" ||
  process.env.FLEET_REQUIRE_TLS === "1" ||
  process.env.FLEET_REQUIRE_TLS === "true";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  ...(hsts
    ? [
        {
          key: "Strict-Transport-Security",
          value: "max-age=31536000; includeSubDomains",
        },
      ]
    : []),
];

// Server-side proxy only — loopback HTTP (never https:// public URL; self-signed breaks SSR).
const apiUpstream =
  process.env.API_UPSTREAM_URL ?? "http://127.0.0.1:4000";

const nextConfig: NextConfig = {
  transpilePackages: ["@fleet/ui", "@fleet/types"],
  poweredByHeader: false,
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${apiUpstream.replace(/\/$/, "")}/api/:path*`,
      },
    ];
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
