import type { NextConfig } from "next";

// Security headers on every response.
const securityHeaders = [
  // Nobody can show DealHold inside a frame (stops click-tricking the seller into "Approve").
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
  // Browsers trust our Content-Type (an uploaded "photo" is never run as a page).
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Links out (e.g. to PayPal) never carry chat ids from our URLs.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
