/**
 * Helpers shared by the Resume AI specs: a fixture resume, API shortcuts that set a
 * person up without spending browser time, and an axe-core runner.
 */
import path from "node:path";
import { expect, type APIRequestContext, type Page } from "@playwright/test";
import type { ResumeDocument, ResumeStatusView, ResumeSummary } from "@open-resume/types";
import { as, type TestUser } from "./helpers";

/** A small, fully fictional resume as the plain text a person might upload. */
export const RESUME_TXT = `Jordan Reyes
Backend Engineer
jordan.reyes@example.com | +1 555 0100 | Denver, CO

SUMMARY
Backend engineer with six years building reliable payment and notification services.

EXPERIENCE
Senior Software Engineer, Harbor Systems, 2021 to Present
- Cut p95 API latency from 480 ms to 190 ms by caching hot reads.
- Led a team of four through a zero-downtime database migration.

Software Engineer, Brightline Labs, 2018 to 2021
- Built the webhook delivery service used by 300 integrators.

EDUCATION
B.S. Computer Science, Calder Bay University, 2014 to 2018

SKILLS
Go, TypeScript, PostgreSQL, Kafka, Kubernetes
`;

export const JOB_DESCRIPTION = "We are hiring a backend engineer to own our payments platform. You will design APIs in Go, run Postgres at scale, and mentor engineers. Kafka and Kubernetes experience is a plus.";

export const DOC: ResumeDocument = {
  personal: { fullName: "Jordan Reyes", headline: "Backend Engineer", email: "jordan.reyes@example.com", phone: "+1 555 0100", location: "Denver, CO" },
  summary: "Backend engineer with six years building reliable payment and notification services.",
  experience: [
    { title: "Senior Software Engineer", company: "Harbor Systems", start: "2021", end: "Present", bullets: ["Cut p95 API latency from 480 ms to 190 ms by caching hot reads.", "Led a team of four through a zero-downtime database migration."] },
  ],
  education: [{ degree: "B.S. Computer Science", institution: "Calder Bay University", start: "2014", end: "2018" }],
  skills: [{ category: "Languages", items: ["Go", "TypeScript", "SQL"] }],
};

export const txtFile = (name = "resume.txt", body = RESUME_TXT) => ({ name, mimeType: "text/plain", buffer: Buffer.from(body, "utf8") });

/** Starts an analysis of the fixture document through the API. */
export async function startAnalysis(request: APIRequestContext, user: TestUser, extra: Record<string, unknown> = {}): Promise<ResumeSummary> {
  return as<ResumeSummary>(request, user, "POST", "/resumes/from-document", { document: DOC, title: "Jordan Reyes, Backend", ...extra });
}

/** Waits until the resume is analysed (fails if it errors). */
export async function waitAnalysed(request: APIRequestContext, user: TestUser, id: string, timeout = 90_000): Promise<void> {
  await expect
    .poll(
      async () => {
        const v = await as<ResumeStatusView>(request, user, "GET", `/resumes/${id}/status`);
        if (v.status === "error") throw new Error(`analysis of ${id} failed: ${JSON.stringify(v.components)}`);
        return v.status;
      },
      { timeout, intervals: [500, 1000, 2000] },
    )
    .toBe("analyzed");
}

export async function analysedResume(request: APIRequestContext, user: TestUser): Promise<ResumeSummary> {
  const r = await startAnalysis(request, user);
  await waitAnalysed(request, user, r.id);
  return r;
}

/** The file bytes a download produced, so a test can check the magic number. */
export async function downloadedBytes(page: Page, click: () => Promise<unknown>): Promise<Buffer> {
  const [dl] = await Promise.all([page.waitForEvent("download"), click()]);
  const stream = await dl.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.from(c as Uint8Array));
  return Buffer.concat(chunks);
}

interface AxeResult {
  violations: { id: string; impact?: string | null; help: string; nodes: { target: unknown[]; html: string }[] }[];
}

/**
 * Runs axe-core (WCAG 2 A and AA) in the page and returns the serious and critical
 * violations, formatted for a readable failure message.
 */
export async function axeProblems(page: Page, opts: { exclude?: string[] } = {}): Promise<string[]> {
  if (!(await page.evaluate(() => "axe" in window))) await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  const result = (await page.evaluate(async (exclude) => {
    const axe = (window as unknown as { axe: { run: (ctx: unknown, o: unknown) => Promise<unknown> } }).axe;
    return axe.run({ exclude: exclude.map((s) => [s]) }, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } });
  }, opts.exclude ?? [])) as AxeResult;
  return result.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id} (${v.impact}): ${v.help}\n${v.nodes.slice(0, 3).map((n) => `  ${n.target.join(" ")}\n    ${n.html.slice(0, 140)}`).join("\n")}`);
}

export { path };
