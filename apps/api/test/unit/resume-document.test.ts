import { describe, expect, test } from "vitest";
import { cleanUrl, isEmptyDocument, LIMITS, normaliseDocument } from "../../src/services/resume/document";

describe("normaliseDocument", () => {
  test("trims, drops empties and unknown keys, never throws on junk", () => {
    expect(normaliseDocument(null)).toEqual({});
    expect(normaliseDocument("x")).toEqual({});
    expect(normaliseDocument([1])).toEqual({});
    const doc = normaliseDocument({
      personal: { fullName: "  Ada  ", email: "", phone: "   " },
      summary: "\u0000hi\u0007 there ",
      experience: [{ title: "  ", bullets: ["", "  a  "] }, { title: " Dev ", bullets: [] }, "nope", null],
      skills: [{ category: "x", items: [] }, { category: "Lang", items: ["TS", "", "Go"] }],
      evil: { __proto__: 1 },
    });
    expect(doc).toEqual({
      personal: { fullName: "Ada" },
      summary: "hi there",
      experience: [{ bullets: ["a"] }, { title: "Dev" }],
      skills: [{ category: "Lang", items: ["TS", "Go"] }],
    });
  });

  test("caps lengths and list sizes", () => {
    const doc = normaliseDocument({
      summary: "x".repeat(10_000),
      experience: Array.from({ length: 100 }, () => ({ title: "t", bullets: Array.from({ length: 100 }, () => "b".repeat(2000)) })),
      achievements: Array.from({ length: 100 }, () => "a"),
    });
    expect(doc.summary!.length).toBe(LIMITS.summary);
    expect(doc.experience).toHaveLength(LIMITS.experience);
    expect(doc.experience![0]!.bullets).toHaveLength(LIMITS.bullets);
    expect(doc.experience![0]!.bullets![0]!.length).toBe(LIMITS.bullet);
    expect(doc.achievements).toHaveLength(LIMITS.achievements);
  });

  test("photo only as a png, jpeg or gif data URL", () => {
    const ok = "data:image/png;base64,iVBORw0KGgo=";
    expect(normaliseDocument({ personal: { photoDataUrl: ok } }).personal?.photoDataUrl).toBe(ok);
    for (const bad of ["data:image/svg+xml;base64,PHN2Zz4=", "data:text/html;base64,PGI+", "https://x.test/a.png", "data:image/png;base64,@@@", "javascript:alert(1)"]) {
      expect(normaliseDocument({ personal: { fullName: "A", photoDataUrl: bad } }).personal).toEqual({ fullName: "A" });
    }
  });

  test("links allow only http, https, mailto and tel", () => {
    expect(cleanUrl("https://example.com/a")).toBe("https://example.com/a");
    expect(cleanUrl("http://example.com")).toBe("http://example.com");
    expect(cleanUrl("mailto:a@example.com")).toBe("mailto:a@example.com");
    expect(cleanUrl("tel:+15551234")).toBe("tel:+15551234");
    expect(cleanUrl("github.com/ada")).toBe("https://github.com/ada");
    for (const bad of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,x", "vbscript:x", "file:///etc/passwd", "ftp://x.test", "not a url", "localhost:3000", "//evil.test"]) {
      expect(cleanUrl(bad)).toBeUndefined();
    }
    const doc = normaliseDocument({ links: { github: "javascript:x", linkedin: "linkedin.com/in/ada", other: [{ label: "bad", url: "javascript:y" }, { label: "ok", url: "https://a.test" }] }, projects: [{ name: "p", link: "data:x" }] });
    expect(doc.links).toEqual({ linkedin: "https://linkedin.com/in/ada", other: [{ label: "ok", url: "https://a.test" }] });
    expect(doc.projects).toEqual([{ name: "p" }]);
  });

  test("isEmptyDocument", () => {
    expect(isEmptyDocument({})).toBe(true);
    expect(isEmptyDocument(normaliseDocument({ links: { github: "github.com/a" } }))).toBe(true);
    expect(isEmptyDocument({ summary: "x" })).toBe(false);
  });
});
