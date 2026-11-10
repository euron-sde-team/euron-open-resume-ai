/** Rendering: mapper, link safety, template allow-list, HTML, DOCX and PDF. */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { unzipSync } from "fflate";
import { afterAll, describe, expect, test } from "vitest";
import { extractText, getDocumentProxy } from "unpdf";
import { DEFAULT_TEMPLATE_ID, TEMPLATE_IDS, type ResumeDocument } from "@open-resume/types";
import samples from "../../../../packages/samples/data/samples.json";
import { closePdfBrowser, findChromium, resumeRenderer, safeHref } from "../../src/services/resume/render";
import { decodePhoto } from "../../src/services/resume/render/docx";
import { fromTemplateResume, normaliseResumeForTemplate, toResumeTemplateData, toPoints } from "../../src/services/resume/render/mapper";
import { resolveTemplateId } from "../../src/services/resume/render/registry";
import { htmlToPdf } from "../../src/services/resume/render/pdf";

const doc: ResumeDocument = {
  personal: { fullName: "Ada <b>Lovelace</b>", headline: "Engineer", email: "ada@example.com", phone: "+1 555 0100", location: "London" },
  links: { github: "github.com/ada", linkedin: "javascript:alert(1)", other: [{ label: "Site", url: "https://example.com/ada" }] },
  summary: "Writes the first programs.",
  experience: [{ title: "Analyst", company: "Analytical Engines", start: "1842", end: "1843", bullets: ["Wrote notes <script>alert(1)</script>", "Shipped"] }],
  education: [{ degree: "Mathematics", institution: "Home", start: "1830", end: "1835", score: "A" }],
  skills: [{ category: "Core", items: ["Maths", "Logic", "maths"] }],
  projects: [{ name: "Notes", description: "A note.", link: "data:text/html,x", tech: ["Ink"], bullets: ["Done"] }],
  certifications: [{ name: "Fellow", issuer: "Society", date: "1840" }],
  languages: [{ name: "English", level: "Native" }],
  achievements: ["First programmer"],
};

describe("safeHref", () => {
  test.each([
    ["https://example.com/a?b=1", "https://example.com/a?b=1"],
    ["http://example.com", "http://example.com"],
    ["mailto:a@example.com", "mailto:a@example.com"],
    ["tel:+15550100", "tel:+15550100"],
    ["github.com/ada", "https://github.com/ada"],
    ["javascript:alert(1)", "#"],
    ["JaVaScRiPt:alert(1)", "#"],
    [" javascript:alert(1)", "#"],
    ["java\tscript:alert(1)", "#"],
    ["data:text/html,<script>", "#"],
    ["file:///etc/passwd", "#"],
    ["vbscript:x", "#"],
    ["//evil.example", "#"],
    ["", "#"],
    [undefined, "#"],
    [42, "#"],
  ])("%j -> %s", (input, out) => {
    expect(safeHref(input)).toBe(out);
  });
});

describe("template allow-list", () => {
  test("known ids, .ejs spellings and legacy short names resolve", () => {
    for (const id of TEMPLATE_IDS) expect(resolveTemplateId(id)).toBe(id);
    expect(resolveTemplateId("modern_resume_template.ejs")).toBe("modern_resume_template");
    expect(resolveTemplateId("simply_blue")).toBe("simply_blue_resume_template");
  });
  test("paths and unknown values fall back to the default", () => {
    for (const bad of ["../../etc/passwd", "../cover_letter", "cover_letter", "certificate", "/etc/passwd", "", undefined, "modern/../x"]) {
      expect(resolveTemplateId(bad)).toBe(DEFAULT_TEMPLATE_ID);
    }
  });
  test("listTemplates describes all 13", () => {
    const list = resumeRenderer.listTemplates();
    expect(list.map((t) => t.id)).toEqual([...TEMPLATE_IDS]);
    for (const t of list) {
      expect(t.name && t.description && /^#[0-9a-f]{6}$/i.test(t.accent)).toBeTruthy();
      expect([1, 2]).toContain(t.columns);
      expect(typeof t.atsFriendly).toBe("boolean");
    }
  });
});

describe("mapper", () => {
  test("maps the canonical document to the legacy template shape", () => {
    const r = toResumeTemplateData(doc).updatedResume as Record<string, any>;
    expect(r.personalInfo).toMatchObject({ name: "Ada <b>Lovelace</b>", title: "Engineer", email: "ada@example.com" });
    expect(r.personalInfo.links).toEqual(["https://github.com/ada", "https://example.com/ada"]);
    expect(r.skills).toEqual(["Maths", "Logic"]);
    expect(r.experience[0]).toMatchObject({ companyName: "Analytical Engines", designation: "Analyst", duration: "1842 - 1843" });
    expect(r.experience[0].description).toHaveLength(2);
    expect(r.projects[0].link).toBeUndefined();
    expect(r.achievements.map((a: { name: string }) => a.name)).toEqual(["First programmer", "Fellow, Society"]);
    expect(r.languages).toEqual([{ name: "English", level: "Native" }]);
  });
  test("never throws on junk", () => {
    for (const junk of [null, undefined, 5, "x", [], { experience: "oops", skills: { a: 1 }, projects: [null, 3], education: { degree: 1 } }]) {
      expect(() => normaliseResumeForTemplate(junk)).not.toThrow();
      expect(() => toResumeTemplateData(junk as ResumeDocument)).not.toThrow();
    }
    expect(toPoints("a\nb")).toEqual([{ point: "a" }, { point: "b" }]);
  });
  test("reverse mapper round-trips the essentials", () => {
    const back = fromTemplateResume(toResumeTemplateData(doc).updatedResume);
    expect(back.personal?.fullName).toBe("Ada <b>Lovelace</b>");
    expect(back.experience?.[0]).toMatchObject({ title: "Analyst", company: "Analytical Engines", start: "1842", end: "1843" });
  });
});

describe("HTML", () => {
  test("every template renders, escapes, filters links and loads nothing external", async () => {
    for (const id of TEMPLATE_IDS) {
      const html = await resumeRenderer.renderHtml(doc, id);
      expect(html, id).toContain("&lt;b&gt;Lovelace&lt;/b&gt;");
      expect(html, id).not.toContain("<script");
      expect(html, id).not.toMatch(/javascript:/i);
      expect(html, id).not.toMatch(/(?:src|href)=["']https?:\/\/(?!example\.com|github\.com)/);
      expect(html, id).not.toMatch(/<link[^>]+href=["']https?:/i);
      expect(html, id).not.toMatch(/@import|fonts\.googleapis|cdnjs/);
      expect(html, id).toContain("Content-Security-Policy");
      // Bullets must reach the page: a template reading the wrong field renders empty list items.
      expect(html, id).toContain("Shipped");
      expect(html, id).toContain("Logic"); // a skill from the document, never a template default
    }
  });
  test("a sample renders with each template", async () => {
    const s = (samples as unknown as ResumeDocument[])[3] as ResumeDocument;
    for (const id of TEMPLATE_IDS) expect((await resumeRenderer.renderHtml(s, id)).length).toBeGreaterThan(5000);
  });
  test("an unknown template id falls back instead of throwing", async () => {
    const html = await resumeRenderer.renderHtml(doc, "../../x" as never);
    expect(html).toContain("Lovelace");
  });
});

describe("DOCX", () => {
  test("is a zip containing the person's name, per template family", async () => {
    for (const id of ["modern_resume_template", "resume_template", "minimalist_resume_template"] as const) {
      const buf = await resumeRenderer.renderDocx(doc, id);
      expect(buf.subarray(0, 2).toString("latin1")).toBe("PK");
      const xml = Buffer.from(unzipSync(new Uint8Array(buf))["word/document.xml"] as Uint8Array).toString("utf8");
      expect(xml).toContain("Ada &lt;b&gt;Lovelace&lt;/b&gt;");
      expect(xml).toContain("Analytical Engines");
      expect(xml).not.toContain("javascript:");
      expect(xml).not.toContain("data:text/html");
    }
  });
  test("no Euri branding in the metadata", async () => {
    const buf = await resumeRenderer.renderDocx(doc, "modern_resume_template");
    const core = Buffer.from(unzipSync(new Uint8Array(buf))["docProps/core.xml"] as Uint8Array).toString("utf8");
    expect(core).not.toMatch(/euri/i);
  });
  test("photo needs png/jpeg/gif whose bytes match", () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(80)]).toString("base64");
    expect(decodePhoto(`data:image/png;base64,${png}`)?.type).toBe("png");
    expect(decodePhoto(`data:image/jpeg;base64,${png}`)).toBeNull();
    expect(decodePhoto(`data:image/svg+xml;base64,${png}`)).toBeNull();
    expect(decodePhoto(`http://example.com/x.png`)).toBeNull();
  });
  test("cover letter docx", async () => {
    const buf = await resumeRenderer.renderCoverLetterDocx({ paragraphs: ["I would like to apply."], closing: "Regards" }, doc);
    const xml = Buffer.from(unzipSync(new Uint8Array(buf))["word/document.xml"] as Uint8Array).toString("utf8");
    expect(xml).toContain("I would like to apply.");
    expect(xml).toContain("Regards,");
  });
});

const chromium = findChromium();
if (!chromium) console.warn("SKIPPING PDF tests: no Chromium found. Set CHROMIUM_PATH.");

async function pdfText(buf: Buffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  return (await extractText(pdf, { mergePages: true })).text;
}

describe.skipIf(!chromium)("PDF", () => {
  afterAll(closePdfBrowser);

  test("starts with %PDF and carries the text", async () => {
    const buf = await resumeRenderer.renderPdf(doc, "modern_resume_template");
    expect(buf.subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect(await pdfText(buf)).toContain("Analytical Engines");
  }, 60_000);

  test("every template produces a one or more page A4 PDF", async () => {
    for (const id of TEMPLATE_IDS) {
      const buf = await resumeRenderer.renderPdf(doc, id);
      expect(buf.subarray(0, 4).toString("latin1"), id).toBe("%PDF");
      expect((await pdfText(buf)).toLowerCase(), id).toContain("lovelace");
    }
  }, 120_000);

  test("cover letter pdf", async () => {
    const buf = await resumeRenderer.renderCoverLetterPdf({ paragraphs: ["Please consider me."], greeting: "Dear team," }, doc);
    expect(await pdfText(buf)).toContain("Please consider me.");
  }, 60_000);

  test("network is blocked: an external <img>, stylesheet and @import cause no outbound request", async () => {
    let hits = 0;
    const server = http.createServer((_req, res) => {
      hits += 1;
      res.writeHead(200, { "content-type": "image/png" }).end(Buffer.alloc(10));
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const html = `<!doctype html><html><head><link rel="stylesheet" href="${base}/a.css"><style>@import url("${base}/b.css"); body{background:url(${base}/c.png)}</style></head><body><img src="${base}/x.png"><p>Offline text</p><iframe src="${base}/f"></iframe></body></html>`;
      const pdf = await htmlToPdf(html);
      expect(await pdfText(pdf)).toContain("Offline text");
      expect(hits).toBe(0);
    } finally {
      server.close();
    }
  }, 60_000);

  test("JavaScript does not run", async () => {
    const pdf = await htmlToPdf(`<!doctype html><body><p id="p">before</p><script>document.getElementById('p').textContent='ran'</script></body>`);
    const text = await pdfText(pdf);
    expect(text).toContain("before");
    expect(text).not.toContain("ran");
  }, 60_000);

  test("concurrent renders share one browser", async () => {
    const out = await Promise.all([1, 2, 3, 4].map(() => resumeRenderer.renderPdf(doc, "resume_template")));
    for (const b of out) expect(b.subarray(0, 4).toString("latin1")).toBe("%PDF");
  }, 90_000);
});
