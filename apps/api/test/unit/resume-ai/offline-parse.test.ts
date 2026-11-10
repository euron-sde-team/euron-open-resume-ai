import type { ResumeDocument } from "@open-resume/types";
import { describe, expect, test } from "vitest";
import { documentToText, normalizeDocument } from "../../../src/services/resume/ai/document";
import { parseResumeText } from "../../../src/services/resume/ai/offline";
import { asDocument, samples } from "./fixtures";

const norm = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();

describe("offline parser: document -> text -> document round trip", () => {
  test("there are samples to test against", () => {
    expect(samples.length).toBeGreaterThanOrEqual(30);
  });

  test.each(samples.map((s) => [s.id, s] as const))("%s keeps its key fields", (_id, sample) => {
    const original = normalizeDocument(asDocument(sample));
    const parsed = parseResumeText(documentToText(original));
    expect(parsed.personal?.fullName).toBe(original.personal?.fullName);
    expect(parsed.personal?.email).toBe(original.personal?.email);
    expect(norm(parsed.personal?.phone)).toBe(norm(original.personal?.phone));
    expect(parsed.personal?.headline).toBe(original.personal?.headline);
    expect(norm(parsed.summary)).toBe(norm(original.summary));
    expect(parsed.experience?.length).toBe(original.experience?.length);
    (original.experience ?? []).forEach((e, i) => {
      const p = parsed.experience?.[i];
      expect(p?.title).toBe(e.title);
      expect(p?.company).toBe(e.company);
      expect(p?.start).toBe(e.start);
      expect(p?.end).toBe(e.end);
      expect(p?.bullets).toEqual(e.bullets);
    });
    expect(parsed.education?.length).toBe(original.education?.length);
    (original.education ?? []).forEach((e, i) => {
      expect(parsed.education?.[i]?.degree).toBe(e.degree);
      expect(parsed.education?.[i]?.institution).toBe(e.institution);
    });
    const skillsOf = (d: ResumeDocument) => (d.skills ?? []).flatMap((g) => g.items ?? []).sort();
    expect(skillsOf(parsed)).toEqual(skillsOf(original));
    expect((parsed.projects ?? []).map((p) => p.name)).toEqual((original.projects ?? []).map((p) => p.name));
    expect((parsed.projects ?? []).map((p) => p.tech)).toEqual((original.projects ?? []).map((p) => p.tech));
    expect((parsed.certifications ?? []).map((c) => c.name)).toEqual((original.certifications ?? []).map((c) => c.name));
    expect((parsed.languages ?? []).map((l) => l.name)).toEqual((original.languages ?? []).map((l) => l.name));
  });
});

describe("offline parser: real-world layouts", () => {
  const messy = `
JANE  DOE
Senior Data Analyst
jane.doe@example.com  |  +44 20 7946 0958  |  London, UK
linkedin.com/in/jane-doe-example • github.com/janedoe-example

PROFESSIONAL SUMMARY
Analyst with a decade of experience turning messy data into decisions.

WORK EXPERIENCE
Senior Data Analyst at Contoso Ltd, London            Mar 2019 - Present
• Built dashboards used by 200 staff
• Cut reporting time by 60%
  across all regional teams
Data Analyst \u2013 Fabrikam (Leeds)  2014 \u2013 2019
- Maintained the sales data warehouse

EDUCATION
MSc Statistics, University of Leeds, 2012 - 2014
BSc Mathematics | Northgate College | 2009 - 2012
Grade: First Class

TECHNICAL SKILLS
Languages: SQL, Python, R
Tools: Tableau, Power BI

CERTIFICATIONS
Tableau Desktop Specialist - Tableau (2021)

Languages: English (Native), French (B2)
`;
  const doc = parseResumeText(messy);

  test("header", () => {
    expect(doc.personal?.fullName).toBe("JANE  DOE".replace(/\s+/g, " "));
    expect(doc.personal?.headline).toBe("Senior Data Analyst");
    expect(doc.personal?.email).toBe("jane.doe@example.com");
    expect(doc.personal?.phone).toContain("7946");
    expect(doc.personal?.location).toBe("London, UK");
    expect(doc.links?.linkedin).toBe("https://linkedin.com/in/jane-doe-example");
    expect(doc.links?.github).toBe("https://github.com/janedoe-example");
  });

  test("experience with dates, bullets and wrapped lines", () => {
    expect(doc.experience).toHaveLength(2);
    expect(doc.experience?.[0]).toMatchObject({ title: "Senior Data Analyst", company: "Contoso Ltd, London", start: "Mar 2019", end: "Present" });
    expect(doc.experience?.[0]?.bullets).toEqual(["Built dashboards used by 200 staff", "Cut reporting time by 60% across all regional teams"]);
    expect(doc.experience?.[1]).toMatchObject({ title: "Data Analyst", start: "2014", end: "2019" });
  });

  test("education, skills, certifications, languages", () => {
    expect(doc.education).toHaveLength(2);
    expect(doc.education?.[0]).toMatchObject({ degree: "MSc Statistics", institution: "University of Leeds", start: "2012", end: "2014" });
    expect(doc.education?.[1]?.score).toBe("Grade: First Class");
    expect(doc.skills?.map((g) => g.category)).toEqual(["Languages", "Tools"]);
    expect(doc.certifications?.[0]?.name).toBe("Tableau Desktop Specialist");
    expect(doc.languages?.map((l) => l.name)).toContain("French");
  });

  test("text with no resume content parses to an empty document", () => {
    const empty = parseResumeText("hello there\nhow are you");
    expect(empty.experience).toHaveLength(0);
    expect(empty.education).toHaveLength(0);
  });
});
