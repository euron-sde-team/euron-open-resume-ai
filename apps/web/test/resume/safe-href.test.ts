import { describe, expect, it } from "vitest";
import { hrefLabel, safeHref } from "@/lib/resume/safe-href";

describe("safeHref", () => {
  it("passes http, https, mailto and tel", () => {
    expect(safeHref("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(safeHref("http://example.com")).toBe("http://example.com/");
    expect(safeHref("mailto:ada@example.com")).toBe("mailto:ada@example.com");
    expect(safeHref("tel:+15550100")).toBe("tel:+15550100");
  });

  it("reads bare hosts as https and bare addresses as mailto", () => {
    expect(safeHref("linkedin.com/in/ada")).toBe("https://linkedin.com/in/ada");
    expect(safeHref("www.example.com")).toBe("https://www.example.com/");
    expect(safeHref("ada@example.com")).toBe("mailto:ada@example.com");
  });

  it.each(["javascript:alert(1)", "JaVaScRiPt:alert(1)", " javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "vbscript:x", "file:///etc/passwd", "blob:https://example.com/x", "//evil.example.com", "ftp://example.com/x", "java\nscript:alert(1)", "https://exa mple.com", "http://", "mailto:", "", "   ", "not a link", "just-a-word"])("refuses %j", (v) => {
    expect(safeHref(v)).toBeNull();
  });

  it("refuses null, undefined and absurdly long values", () => {
    expect(safeHref(null)).toBeNull();
    expect(safeHref(undefined)).toBeNull();
    expect(safeHref(`https://example.com/${"a".repeat(3000)}`)).toBeNull();
  });

  it("labels a link without its scheme", () => {
    expect(hrefLabel("https://example.com/")).toBe("example.com");
    expect(hrefLabel("mailto:ada@example.com")).toBe("ada@example.com");
  });
});
