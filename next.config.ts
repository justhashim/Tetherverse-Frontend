import type { NextConfig } from "next";

/**
 * Split on commas and trim. Exported so the launcher origin list has exactly one
 * definition - it is read both here and by the frame that accepts bridged
 * tokens, and two copies of an allowlist is how the copies drift apart.
 */
function csv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

/** Origins that embed this app, as CSP `frame-ancestors` source expressions. */
function launcherFrameSources(): string[] {
  const origins = csv(process.env.NEXT_PUBLIC_LAUNCHER_ORIGIN);
  return origins.length ? origins : [];
}

/**
 * Builds the Content-Security-Policy for a request.
 *
 * ── Why this is a policy and not just a header ──────────────────────────────
 *
 * There is no `dangerouslySetInnerHTML`, no `eval`, and no user-controlled HTML
 * anywhere in this app, so there is no XSS to fix here today. A CSP is not
 * therefore redundant: it is the thing that keeps that true. The leaderboard
 * renders display names and avatar URLs that come from the accounts backend, and
 * the day one of those is rendered unsafely the difference between a defacement
 * and a stolen session token is whether this policy existed.
 *
 * ── The parts that are deliberately loose ───────────────────────────────────
 *
 * `script-src` allows `'unsafe-inline'`, which is the weak directive in here.
 * Next.js App Router emits inline bootstrap scripts, so a nonce-free policy
 * cannot remove it without serving a per-request nonce through middleware -
 * which is unsupported in this app's Cloudflare Workers target and would break
 * the deploy. The comment is here so the tradeoff is a decision rather than an
 * accident: moving to nonces is the upgrade path, and it is worth taking if this
 * app ever grows server-rendered user content.
 *
 * Everything else is closed hard, because nothing else needed opening: no
 * inline scripts means no `'unsafe-eval'`, no third-party frames means
 * `frame-ancestors` is an allowlist rather than a wildcard, and no plugins means
 * `object-src 'none'`.
 */
function contentSecurityPolicy(): string {
  const dev = process.env.NODE_ENV !== "production";

  // The launcher origins, or nothing. Defaulting to '*' here would hand every
  // site on the internet a clickjacking surface over a sign-in button and a game
  // canvas; defaulting to 'self' costs a broken embed until the variable is set,
  // which is the cheaper of the two failures by a wide margin.
  const frameAncestors = ["'self'", ...launcherFrameSources()];

  // Avatar hosts. These are the only remote origins the app loads at all - the
  // backgrounds are local PNGs - so the allowlist is the real boundary rather
  // than a decorative one.
  const imgHosts = [
    "https://lh3.googleusercontent.com",
    "https://*.googleusercontent.com",
    "https://avatars.githubusercontent.com",
  ];

  // The HMR socket and the dev runtime need more than production does, and
  // giving production that room would be a permanent hole opened for a
  // development convenience.
  const connectSrc = dev
    ? ["'self'", "ws:", "wss:"]
    : ["'self'"];
  const scriptSrc = dev
    ? ["'self'", "'unsafe-inline'", "'unsafe-eval'"]
    : ["'self'", "'unsafe-inline'"];

  const directives: [string, string[]][] = [
    ["default-src", ["'self'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    ["object-src", ["'none'"]],
    ["frame-ancestors", frameAncestors],
    ["script-src", scriptSrc],
    // Phaser and framer-motion both drive layout from inline styles, so this
    // cannot be tightened without redesigning how the game writes to the DOM.
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", ["'self'", "data:", "blob:", ...imgHosts]],
    ["font-src", ["'self'", "data:"]],
    ["connect-src", connectSrc],
    ["media-src", ["'self'"]],
    // The coin texture and any sprite sheet are generated into a blob at boot.
    ["worker-src", ["'self'", "blob:"]],
    ["manifest-src", ["'self'"]],
  ];

  const policy = directives
    .map(([name, sources]) => `${name} ${sources.join(" ")}`)
    .join("; ");

  return dev ? policy : `${policy}; upgrade-insecure-requests`;
}

const isProduction = process.env.NODE_ENV === "production";

/**
 * Security headers for every response.
 *
 * Two of these are load-bearing for the product rather than generic hygiene:
 *
 * `frame-ancestors` is the clickjacking control, and it is an allowlist. This app
 * is MEANT to be framed - the launcher embeds it and delivers the auth token over
 * postMessage - so `X-Frame-Options` cannot be used at all: it only knows how to
 * allow or deny the world, and both answers are wrong here. CSP is the only
 * mechanism that can express "nobody except these origins".
 *
 * `Referrer-Policy` keeps the path and query off cross-origin navigations. The
 * game carries no secrets in URLs today, but the leaderboard and the auth
 * redirect both navigate away from this origin, and a strict referrer is free.
 *
 * `Strict-Transport-Security` is set with includeSubDomains deliberately: the
 * whole point is that the accounts frontend and the API sit on sibling hosts, and
 * an attacker who can strip TLS to one of them has the session regardless of what
 * this app does.
 */
const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: contentSecurityPolicy(),
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    // The game needs none of these. Camera and microphone in particular have no
    // path to being used here, and the policy is the standing proof of that.
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  },
  {
    key: "X-DNS-Prefetch-Control",
    value: "off",
  },
  ...(isProduction
    ? [
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains; preload",
        },
        {
          key: "X-Permitted-Cross-Domain-Policies",
          value: "none",
        },
      ]
    : []),
];

const nextConfig: NextConfig = {
  /**
   * Origins allowed to load the dev server.
   *
   * Read from the environment rather than hard-coded, because a machine-local
   * address in this file is a developer detail that does not belong in a shared
   * repository. Comma-separated; empty means only localhost is allowed.
   */
  allowedDevOrigins: csv(process.env.ALLOWED_DEV_ORIGINS),

  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },

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
        hostname: "avatars.githubusercontent.com",
      },
    ],
  },
};

export default nextConfig;
