/**
 * Output safety helpers shared by the HTML templates and the DOCX builder. Resume data is
 * untrusted (an upload, a model, a pasted JSON), so every link and image that reaches a
 * rendered document passes through one of these.
 */

const HREF_SCHEMES = new Set(["http:", "https:", "mailto:", "tel:"]);

/**
 * A link that is safe to put in an `href`: http, https, mailto or tel only. A bare domain
 * ("github.com/ada") gets https. Anything else (javascript:, data:, file:, vbscript:,
 * control characters, spaces) becomes "#", which the templates render as a dead link.
 */
export function safeHref(input: unknown): string {
  const url = cleanUrl(input);
  return url ?? "#";
}

/** Like {@link safeHref} but `undefined` for anything unusable, so callers can skip the link. */
export function cleanUrl(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  const raw = input.trim();
  if (!raw || raw.length > 2048) return undefined;
  // Control characters and whitespace inside a URL are how scheme filters get bypassed.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\s]/.test(raw)) return undefined;

  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(raw);
  if (scheme) {
    const proto = `${(scheme[1] as string).toLowerCase()}:`;
    if (!HREF_SCHEMES.has(proto)) {
      // "example.com:8080/x" parses as a scheme; treat host:port as a bare domain.
      if (/^[a-z0-9.-]+\.[a-z]{2,}:\d{2,5}(\/|$)/i.test(raw)) return `https://${raw}`;
      return undefined;
    }
    if (proto === "http:" || proto === "https:") {
      try {
        const parsed = new URL(raw);
        if (!parsed.hostname) return undefined;
      } catch {
        return undefined;
      }
    }
    return raw;
  }
  if (raw.startsWith("//")) return undefined;
  // A bare domain or path on a domain: "linkedin.com/in/ada".
  if (/^[a-z0-9][a-z0-9-]*(\.[a-z0-9-]+)+(\/\S*)?$/i.test(raw)) return `https://${raw}`;
  return undefined;
}

/** `data:image/(png|jpeg|gif);base64,...` only, with a sane size; anything else is dropped. */
export function safeDataImage(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  const raw = input.trim();
  if (raw.length > 4_000_000) return undefined;
  if (!/^data:image\/(png|jpeg|gif);base64,[A-Za-z0-9+/]+=*$/.test(raw)) return undefined;
  return raw;
}

/** HTML-escape for the few places a template string is built by hand. */
export function escapeHtml(input: unknown): string {
  return String(input ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
