import type { NextConfig } from "next";
import pkg from "./package.json";

const nextConfig: NextConfig = {
  // Shown in the game. Bump package.json "version" (patch) on every push to main.
  env: { NEXT_PUBLIC_APP_VERSION: pkg.version, NEXT_PUBLIC_BASE_PATH: "/marchipoly" },
  // Served at games.hailatat.icu/marchipoly (hub proxies /marchipoly/* here, Next.js multi-zones).
  basePath: "/marchipoly",
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
