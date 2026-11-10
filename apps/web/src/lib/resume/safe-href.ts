/**
 * Links that come from resume data (a profile URL, a project link) are user or AI text.
 * Only these schemes may become an href; anything else renders as plain text.
 */
const ALLOWED = new Set(["http:", "https:", "mailto:", "tel:"]);

/**
 * The href to use, or null when the value is not a safe link. A bare host
 * ("linkedin.com/in/ada", "www.example.com") is read as https; an email address as mailto.
 */
export function safeHref(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim();
  if (!raw || raw.length > 2048 || /[\u0000-\u001f\u007f\s]/.test(raw)) return null;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(raw);
  if (scheme) {
    // "host:8080/path" has a scheme-looking prefix; a real scheme is followed by // or by an address.
    const s = `${scheme[1]!.toLowerCase()}:`;
    if (ALLOWED.has(s)) {
      if (s === "http:" || s === "https:") {
        try {
          const u = new URL(raw);
          return u.hostname ? u.toString() : null;
        } catch {
          return null;
        }
      }
      return raw.length > s.length ? raw : null;
    }
    // Not an allowed scheme: only "host:port/..." shapes fall through to the bare-host rule.
    if (!/^[a-z0-9.-]+:\d+(\/|$)/i.test(raw)) return null;
  }
  if (/^[^@/\s]+@[^@/\s]+\.[a-z]{2,}$/i.test(raw)) return `mailto:${raw}`;
  if (/^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?([/?#]\S*)?$/i.test(raw)) {
    try {
      return new URL(`https://${raw}`).toString();
    } catch {
      return null;
    }
  }
  return null;
}

/** The text to show for a link: the value without its scheme. */
export function hrefLabel(value: string): string {
  return value.replace(/^(https?:\/\/|mailto:|tel:)/i, "").replace(/\/$/, "");
}
