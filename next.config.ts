import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Origins allowed to load the dev server.
   *
   * Read from the environment rather than hard-coded, because a machine-local
   * address in this file is a developer detail that does not belong in a shared
   * repository. Comma-separated; empty means only localhost is allowed.
   */
  allowedDevOrigins: process.env.ALLOWED_DEV_ORIGINS?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),

  /**
   * Image optimization is off, deliberately.
   *
   * Next's optimizer runs in the server runtime, and the Cloudflare Workers
   * runtime cannot run it: it needs a native image library that the isolate
   * cannot load. The alternative is Cloudflare Image Resizing, which needs a
   * `cf:image` binding and a real Cloudflare zone, so it would not work on a
   * workers.dev address at all.
   *
   * So the browser gets the original file. That costs little here: the
   * backgrounds are local PNGs already served from the CDN, and the two remote
   * images are Google profile avatars, which are small and already compressed.
   */
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
      {
        protocol: "https",
        hostname: "*.googleusercontent.com",
      },
      {
        protocol: "https",
        hostname: "avatars.githubusercontent.com",
      },
    ],
  },
};

export default nextConfig;
