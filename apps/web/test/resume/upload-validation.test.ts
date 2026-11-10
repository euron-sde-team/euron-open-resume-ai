import { describe, expect, it } from "vitest";
import { effectiveMaxMb, extensionOf, formatBytes, validateResumeFile } from "@/lib/resume/upload-validation";

const MB = 1024 * 1024;

describe("upload validation", () => {
  it("accepts the four document types", () => {
    for (const n of ["cv.pdf", "cv.DOCX", "notes.txt", "cv.md"]) expect(validateResumeFile({ name: n, size: 1000 }).ok).toBe(true);
  });

  it("refuses other types, double extensions that end wrong, and no extension", () => {
    for (const n of ["cv.exe", "cv.pdf.exe", "cv", "cv.doc", "cv.png"]) {
      const r = validateResumeFile({ name: n, size: 1000 });
      expect(r.ok).toBe(false);
      expect(r.problem).toBe("type");
    }
  });

  it("refuses an empty file", () => {
    expect(validateResumeFile({ name: "cv.pdf", size: 0 })).toMatchObject({ ok: false, problem: "empty" });
  });

  it("applies the tier limit but never above 10 MB", () => {
    expect(effectiveMaxMb(null)).toBe(10);
    expect(effectiveMaxMb(0)).toBe(10);
    expect(effectiveMaxMb(3)).toBe(3);
    expect(effectiveMaxMb(50)).toBe(10);
    expect(validateResumeFile({ name: "cv.pdf", size: 3 * MB + 1 }, 3)).toMatchObject({ ok: false, problem: "size", message: "That file is larger than 3 MB." });
    expect(validateResumeFile({ name: "cv.pdf", size: 3 * MB }, 3).ok).toBe(true);
    expect(validateResumeFile({ name: "cv.pdf", size: 11 * MB }, 50).ok).toBe(false);
  });

  it("reads extensions and formats sizes", () => {
    expect(extensionOf("a.b.PDF")).toBe("pdf");
    expect(extensionOf("noext")).toBe("");
    expect(formatBytes(500)).toBe("500 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(3.5 * MB)).toBe("3.5 MB");
  });
});
