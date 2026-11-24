import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  devIndicators: false,
  /*
   * Ship the framework's own bits compressed, and drop the source maps from the
   * client bundle: the deployed app is served over a mobile connection in
   * testing, and a 1.5MB uncompressed JS payload is most of the "it takes ages
   * to refresh" feeling. The server keeps its maps.
   */
  compress: true,
  productionBrowserSourceMaps: false,
  experimental: {
    /*
     * The dashboard's heaviest client bundle is the availability grid + task
     * dialog. Optimising the package imports stops those pulling in more of
     * lodash-like third-party barrels than they use.
     */
    optimizePackageImports: ["zod"],
  },
  // Dev-server origin allow-list so the hosted preview proxy can load HMR assets.
  allowedDevOrigins: [
    "localhost",
    "127.0.0.1",
    "localhost:8080",
    "127.0.0.1:8080",
    "*.e2b.app",
    "*.arena.ai",
    "*.vercel.app",
  ],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
