/** The seam ResumeAiTasks end to end: through the stub provider, and offline. */
import { INTERVIEW_TRACKS } from "@open-resume/types";
import { afterEach, describe, expect, test } from "vitest";
import { db } from "../../src/db/kysely";
import { clearModelCache } from "../../src/services/models.service";
import { resumeAiTasks } from "../../src/services/resume/ai";
import { stubRequests } from "./harness";

const doc = {
  personal: { fullName: "Ada Lovelace", email: "ada@example.com", phone: "+44 20 7946 0958", photoDataUrl: "data:image/png;base64,QUJD" },
  experience: [{ title: "Engineer", company: "Babbage Works", start: "1842", end: "1843", bullets: ["Responsible for writing notes", "Built an algorithm"] }],
  skills: [{ category: "Skills", items: ["Mathematics"] }],
};
const ctx = { userId: "u1" };
const job = { jd: "Data Analyst\nWe need mathematics and notes.", company: "Analytical Co" };

let saved: { id: string; enabled: boolean }[] | null = null;
async function offline(on: boolean) {
  if (on) {
    saved = await db.selectFrom("models").select(["id", "enabled"]).execute();
    await db.updateTable("models").set({ enabled: false }).execute();
  } else if (saved) {
    for (const m of saved) await db.updateTable("models").set({ enabled: m.enabled }).where("id", "=", m.id).execute();
    saved = null;
  }
  clearModelCache();
}
afterEach(() => offline(false));

describe("through the stub provider", () => {
  test("analyze runs analysis, rewrite and the second analysis, keeping the owner's fields", async () => {
    const r = await resumeAiTasks.analyze(doc, job, ctx);
    expect(r.usage.offline).toBe(false);
    expect(r.usage.inputTokens).toBeGreaterThan(0);
    expect(r.after.score).toBeGreaterThan(r.before.score);
    expect(r.improved.personal).toMatchObject({ fullName: "Ada Lovelace", email: "ada@example.com", photoDataUrl: "data:image/png;base64,QUJD" });
    expect(r.coverLetter.header?.company).toBe("Analytical Co");
    const tasks = (await stubRequests()).map((q) => /\[task:([a-z_]+)\]/.exec(JSON.stringify(q.body))?.[1]).filter(Boolean);
    expect(tasks).toEqual(expect.arrayContaining(["analysis", "rewrite", "analysis_after"]));
  });

  test("parse, interview tracks, roadmap and projects", async () => {
    expect((await resumeAiTasks.parseDocument("Some resume text that is long enough to read.", ctx)).personal?.fullName).toBe("Stub Candidate");
    for (const t of INTERVIEW_TRACKS) expect((await resumeAiTasks.interview(t, doc, job, ctx)).length).toBeGreaterThan(0);
    expect((await resumeAiTasks.roadmap(doc, job, ctx)).phases.length).toBeGreaterThan(0);
    expect((await resumeAiTasks.projects(doc, job, ctx)).length).toBeGreaterThan(0);
  });
});

describe("offline", () => {
  test("every task works with no model and marks usage.offline", async () => {
    await offline(true);
    const r = await resumeAiTasks.analyze(doc, job, ctx);
    expect(r.usage).toEqual({ inputTokens: 0, outputTokens: 0, offline: true });
    expect(r.improved.experience?.[0]?.bullets?.[0]).toBe("Wrote notes");
    expect(r.improved.personal?.photoDataUrl).toBe("data:image/png;base64,QUJD");
    expect(r.coverLetter.paragraphs.length).toBeGreaterThan(1);
    for (const t of INTERVIEW_TRACKS) expect((await resumeAiTasks.interview(t, doc, job, ctx)).length).toBeGreaterThan(0);
    expect((await resumeAiTasks.roadmap(doc, job, ctx)).targetRole).toBe("Data Analyst");
    expect((await resumeAiTasks.projects(doc, job, ctx)).length).toBe(3);
    expect((await resumeAiTasks.parseDocument("Ada Lovelace\nada@example.com\n\nSKILLS\nMathematics, Notes", ctx)).skills).toHaveLength(1);
  });

  test("text with no resume in it is a clear AiBadOutput", async () => {
    await offline(true);
    await expect(resumeAiTasks.parseDocument("hello there this is not a resume at all", ctx)).rejects.toMatchObject({ code: "AI_BAD_OUTPUT" });
  });
});
