import type { MetadataRoute } from "next";

/**
 * Nothing here is for search engines: every page needs a session.
 */
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", disallow: "/" }] };
}
