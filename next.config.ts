import type { NextConfig } from "next";

/**
 * Content-Security-Policy without `unsafe-inline` (§13 Security).
 * Next injects a nonce into its own inline scripts when a nonce is present in
 * the CSP header; the nonce is generated per request in middleware.ts and the
 * header is set there. This file only carries the static, nonce-free headers.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  devIndicators: false,
  serverExternalPackages: [
    "@node-rs/argon2",
    "fluent-ffmpeg",
    "ffmpeg-static",
    "bullmq",
    "ioredis",
    "nodemailer",
    "@google-cloud/speech",
    "@google-cloud/storage",
    "exceljs",
  ],
  experimental: {
    middlewareClientMaxBodySize: "10gb",
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
