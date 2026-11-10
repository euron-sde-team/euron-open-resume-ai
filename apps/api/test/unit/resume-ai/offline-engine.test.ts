import { INTERVIEW_TRACKS } from "@open-resume/types";
import { describe, expect, test } from "vitest";
import { documentToText, normalizeDocument } from "../../../src/services/resume/ai/document";
import { analyzeOffline, chatOffline, coverLetterOffline, improveBullet, improveDocument, interviewOffline, projectsOffline, roadmapOffline } from "../../../src/services/resume/ai/offline";
import { analysisReportSchema, chatSchema, coverLetterSchema, interviewSchema, projectsSchema, roadmapSchema } from "../../../src/services/resume/ai/schemas";
import { asDocument, BARE, JD, samples, STRONG } from "./fixtures";

describe("scoring", () => {
  test("a resume with quantified bullets and the JD keywords outscores a bare one", () => {
    const strong = analyzeOffline(STRONG, JD);
    const bare = analyzeOffline(BARE, JD);
    expect(strong.score).toBeGreaterThan(bare.score + 25);
    expect(strong.keywords.matched).toEqual(expect.arrayContaining(["node.js", "postgresql", "docker"]));
    expect(bare.keywords.missing.length).toBeGreaterThan(strong.keywords.missing.length);
  });

  test("adding a measurable result raises the score, filler lowers it", () => {
    const base = normalizeDocument(BARE);
    const quantified = normalizeDocument({ ...BARE, experience: [{ ...BARE.experience![0], bullets: ["Built an internal website used by 300 staff", "Cut testing time by 40% with automated checks", "Supported 12 releases"] }] });
    expect(analyzeOffline(quantified).score).toBeGreaterThan(analyzeOffline(base).score);
  });

  test("adding the job's keywords the candidate really has raises the keyword score", () => {
    const without = normalizeDocument({ ...STRONG, skills: [{ category: "Languages", items: ["TypeScript"] }] });
    expect(analyzeOffline(STRONG, JD).score).toBeGreaterThan(analyzeOffline(without, JD).score);
  });

  test("scores stay within 0..100 and the report passes its schema for every sample", () => {
    for (const s of samples) {
      const r = analyzeOffline(normalizeDocument(asDocument(s)), JD);
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
      expect(analysisReportSchema.safeParse(r).success).toBe(true);
    }
    expect(analyzeOffline({}).score).toBeLessThan(15);
  });

  test("is deterministic", () => {
    expect(analyzeOffline(STRONG, JD)).toEqual(analyzeOffline(STRONG, JD));
  });

  test("reports repetition and weak bullets", () => {
    const r = analyzeOffline(BARE);
    expect(r.weaknesses.join(" ")).toMatch(/filler|responsible for|worked on/i);
    const rep = analyzeOffline(normalizeDocument({ experience: [{ title: "Dev", company: "X", bullets: ["Managed a", "Managed b", "Managed c", "Managed d"] }] }));
    expect(rep.repetitivePhrases.join(" ")).toContain("managed");
  });
});

describe("improver", () => {
  test.each([
    ["Responsible for managing the release process", "Managed the release process"],
    ["Worked on building a billing service", "Built a billing service"],
    ["Helped with onboarding of new hires", "Supported onboarding of new hires"],
    ["I led a team of 5 engineers", "Led a team of 5 engineers"],
    ["Responsible for customer onboarding", "Owned customer onboarding"],
    ["Successfully delivered various reports in order to cut costs by 20%", "Delivered reports to cut costs by 20%"],
  ])("%s", (input, expected) => {
    expect(improveBullet(input)).toBe(expected);
  });

  test("never changes numbers, employers, titles or dates and improves the score", () => {
    const improved = improveDocument(normalizeDocument(BARE), { jd: JD }, new Date("2026-01-01"));
    expect(improved.experience?.[0]).toMatchObject({ title: "Developer", company: "Northwind", start: "2020", end: "2023" });
    expect(improved.experience?.[0]?.bullets?.[0]).toBe("Owned tasks");
    expect(improved.summary).toBeTruthy();
    expect(analyzeOffline(improved, JD).score).toBeGreaterThanOrEqual(analyzeOffline(normalizeDocument(BARE), JD).score);
    const digits = (d: object) => (JSON.stringify(d).match(/\d+/g) ?? []).sort().join(",");
    for (const s of samples.slice(0, 20)) {
      const doc = normalizeDocument(asDocument(s));
      const out = improveDocument(doc, {}, new Date("2026-01-01"));
      const skill = (d: typeof doc) => (d.skills ?? []).flatMap((g) => g.items ?? []).sort().join("|");
      expect(skill(out)).toBe(skill(doc));
      expect(out.experience?.map((e) => [e.title, e.company, e.start, e.end])).toEqual(doc.experience?.map((e) => [e.title, e.company, e.start, e.end]));
      expect(digits(out.experience ?? [])).toBe(digits(doc.experience ?? []));
    }
  });

  test("puts the skills the job asks for first without adding any", () => {
    const out = improveDocument(normalizeDocument({ skills: [{ category: "Tools", items: ["Git", "Docker", "Excel"] }] }), { jd: "We use Docker daily." });
    expect(out.skills?.[0]?.items).toEqual(["Docker", "Git", "Excel"]);
  });
});

describe("cover letter", () => {
  test("uses the candidate's own bullets, the company and the JD keywords", () => {
    const letter = coverLetterOffline(STRONG, { jd: JD, company: "Contoso" });
    expect(coverLetterSchema.safeParse(letter).success).toBe(true);
    const all = letter.paragraphs.join(" ");
    expect(all).toContain("Contoso");
    expect(all).toContain("Backend Engineer");
    expect(all).toMatch(/Built a REST API/i);
    expect(letter.greeting).toBe("Dear Contoso Hiring Team,");
    expect(letter.header?.name).toBe("Sam Rowe");
    expect(all).not.toMatch(/\$|salary|lakh|INR/i);
  });
  test("works with nothing but a name", () => {
    expect(coverLetterSchema.safeParse(coverLetterOffline({ personal: { fullName: "A B" } }, {})).success).toBe(true);
  });
});

describe("questions, roadmap, projects", () => {
  test.each(INTERVIEW_TRACKS)("%s questions are specific, complete and valid", (track) => {
    const groups = interviewOffline(track, STRONG, { jd: JD, company: "Contoso" });
    expect(interviewSchema.safeParse({ groups }).success).toBe(true);
    expect(groups.length).toBeGreaterThanOrEqual(2);
    for (const g of groups) for (const i of g.items) {
      expect(i.question.length).toBeGreaterThan(15);
      expect(i.answer.length).toBeGreaterThan(40);
    }
  });

  test("questions follow the candidate's skills and level", () => {
    const prog = JSON.stringify(interviewOffline("programming", STRONG));
    expect(prog).toMatch(/Node\.js/);
    expect(prog).toMatch(/SQL/);
    expect(prog).toContain("Built a REST API");
    const py = JSON.stringify(interviewOffline("dsa", normalizeDocument({ skills: [{ items: ["Python"] }] })));
    expect(py).toContain("def two_sum");
    const js = JSON.stringify(interviewOffline("dsa", normalizeDocument({ skills: [{ items: ["TypeScript", "React"] }] })));
    expect(js).toContain("function twoSum");
    expect(JSON.stringify(interviewOffline("non_technical", STRONG))).toContain("Northwind");
  });

  test("roadmap and projects target the skills gap against the JD", () => {
    const road = roadmapOffline(STRONG, { jd: JD });
    expect(roadmapSchema.safeParse(road).success).toBe(true);
    expect(road.targetRole).toBe("Backend Engineer");
    expect(JSON.stringify(road.phases)).toMatch(/graphql|kafka/i);
    const projects = projectsOffline(STRONG, { jd: JD });
    expect(projectsSchema.safeParse({ projects }).success).toBe(true);
    expect(projects.map((p) => p.difficulty)).toEqual(["beginner", "intermediate", "advanced"]);
    expect(projects.every((p) => p.resumeBullet.includes("[add"))).toBe(true);
  });

  test("every sample yields valid roadmap, projects and non-empty questions", () => {
    for (const s of samples) {
      const doc = normalizeDocument(asDocument(s));
      expect(roadmapSchema.safeParse(roadmapOffline(doc)).success).toBe(true);
      expect(projectsSchema.safeParse({ projects: projectsOffline(doc) }).success).toBe(true);
      expect(interviewSchema.safeParse({ groups: interviewOffline("programming", doc) }).success).toBe(true);
    }
  });

  test("no currency or country assumptions anywhere in the offline output", () => {
    const text = JSON.stringify([roadmapOffline(STRONG), projectsOffline(STRONG), ...INTERVIEW_TRACKS.map((t) => interviewOffline(t, STRONG))]);
    expect(text).not.toMatch(/lakh|INR|\bLPA\b|salary package/i);
  });
});

describe("chat builder (offline)", () => {
  test("merges contact details and asks for the next missing piece", () => {
    const first = chatOffline({ messages: [{ role: "user", content: "My name is ada lovelace, email ada@example.com, phone +44 20 7946 0958. See github.com/ada-example" }] });
    expect(chatSchema.safeParse({ assistant_message: first.assistant, document: first.document, next_prompts: first.nextPrompts }).success).toBe(true);
    expect(first.document.personal).toMatchObject({ fullName: "Ada Lovelace", email: "ada@example.com" });
    expect(first.document.links?.github).toBe("https://github.com/ada-example");
    expect(first.assistant).toMatch(/role are you aiming for/i);
    expect(first.nextPrompts.length).toBeGreaterThan(0);
  });

  test("a pasted resume fills sections and keeps what was already there", () => {
    const text = documentToText(STRONG);
    const res = chatOffline({ messages: [{ role: "user", content: text }], document: { personal: { fullName: "Existing Name", photoDataUrl: "data:image/png;base64,AAAA" }, summary: "Mine." } });
    expect(res.document.personal?.fullName).toBe("Existing Name");
    expect(res.document.summary).toBe("Mine.");
    expect(res.document.experience).toHaveLength(1);
    expect(res.document.skills?.length).toBeGreaterThan(0);
  });

  test("hello with nothing to read is not an error", () => {
    const r = chatOffline({ messages: [{ role: "user", content: "hi" }] });
    expect(r.assistant).toMatch(/name/i);
  });
});
