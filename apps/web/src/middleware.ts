import { NextResponse, type NextRequest } from "next/server";
import { mediaOrigins } from "@/lib/runtime-env";

/**
 * Per-request Content-Security-Policy with a nonce. Next reads the nonce from the
 * request's CSP header and stamps it on its own scripts; `strict-dynamic` lets those
 * load the app chunks. Origins come from the runtime environment, so one image fits
 * every deployment:
 *   MEDIA_ORIGINS  where uploads go and signed file URLs point (the S3 bucket, the local
 *                  emulator, a CDN). Signed file URLs need img-src and media-src.
 * Model output is never rendered as HTML; the policy below is the backstop. The resume
 * preview is an iframe with an empty `sandbox` and a srcdoc, which is why frame-src names
 * 'self' and blob: and nothing remote.
 */
export function buildCsp(opts: { nonce: string; dev: boolean; media: string[] }): string {
  const media = opts.media.join(" ");
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${opts.nonce}' 'strict-dynamic'${opts.dev ? " 'unsafe-eval'" : ""}`,
    // Radix positions popovers with inline styles. Styles cannot run code.
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${media}`.trim(),
    `media-src 'self' blob: ${media}`.trim(),
    "font-src 'self' data:",
    `connect-src 'self' ${media}${opts.dev ? " ws: wss:" : ""}`.trim(),
    // The resume preview is a sandboxed srcdoc iframe (no scripts, no same-origin); nothing else may frame.
    "frame-src 'self' blob:",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "manifest-src 'self'",
    "worker-src 'self' blob:",
  ];
  return directives.join("; ");
}

export function middleware(req: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp({
    nonce,
    dev: process.env.NODE_ENV !== "production",
    media: mediaOrigins(process.env.MEDIA_ORIGINS),
  });

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|env.js|icon.svg|favicon.ico).*)",
      missing: [{ type: "header", key: "next-router-prefetch" }],
    },
  ],
};
