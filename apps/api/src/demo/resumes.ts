/**
 * Demo resumes: real analyses, run through the same service layer and pipeline as the API
 * (inline, with the offline engine), so the app opens with something to read. Sample
 * people come from @open-resume/samples (synthetic: example.com only).
 */
import { samples } from "@open-resume/samples";
import type { ResumeDocument, TemplateId } from "@open-resume/types";
import type { Actor, RequestMeta } from "../core/context";
import { newId } from "../core/ids";
import { db } from "../db/kysely";
import { createFromDocument, createFromUpload, generateComponent, tailor } from "../services/resume/resume.service";

const META: RequestMeta = { requestId: "demo-seed", ip: null, userAgent: "demo-seed" };

/** A resume with the habits the analyser exists to fix: filler openers, no numbers, thin summary. */
const WEAK_RESUME = `John Carter
john.carter@example.com | 555-0101 | Austin, TX

Summary
I am a hard working person looking for a good opportunity in software.

Experience
Software Developer, Brightline Systems, 2019 - 2023
- Responsible for developing features for the web application
- Worked on bug fixes and helped the team with various tasks
- Was involved in code reviews and meetings
- Responsible for managing the database

Education
B.Sc Computer Science, Lakeside Institute of Technology, 2015 - 2019

Skills
Java, SQL, JavaScript, Git
`;

const BACKEND_JD =
  "We are hiring a backend engineer to build and run APIs on Node.js and PostgreSQL. You will design services, own reliability on Kubernetes, write tests, and mentor teammates. Experience with TypeScript, CI/CD and observability is a plus.";

function pick(role: string, level: string): { doc: ResumeDocument; template: TemplateId } {
  const s = samples.find((x) => x.role.toLowerCase().includes(role) && x.level === level) ?? samples.find((x) => x.role.toLowerCase().includes(role)) ?? samples[0]!;
  const { personal, links, summary, experience, education, skills, projects, certifications, languages, achievements } = s;
  return { doc: { personal, links, summary, experience, education, skills, projects, certifications, languages, achievements } as ResumeDocument, template: s.suggestedTemplate as TemplateId };
}

async function settle(userId: string): Promise<void> {
  // JOBS_MODE=inline has already run the work; wait for any component still marked processing.
  for (let i = 0; i < 40; i++) {
    const busy = await db.selectFrom("resume_components as c").innerJoin("resumes as r", "r.id", "c.resume_id").select("c.resume_id").where("r.user_id", "=", userId).where("c.status", "=", "processing").executeTakeFirst();
    if (!busy) return;
    await new Promise((r) => setTimeout(r, 250));
  }
}

export async function seedDemoResumes(people: Actor[]): Promise<void> {
  const [priya, leo, sam, amara] = people;
  if (!priya || !leo || !sam || !amara) return;

  // Priya: a tailored upload with every generated part, a builder resume, a weak one, a draft.
  const backend = pick("backend", "senior");
  const tailored = await createFromDocument(priya, { document: backend.doc, templateId: backend.template, jd: BACKEND_JD, company: "Harbor Labs", title: "Backend Engineer, Harbor Labs" }, META);
  await generateComponent(priya, tailored.id, "roadmap");
  await generateComponent(priya, tailored.id, "projects");
  await generateComponent(priya, tailored.id, "interview_dsa");
  await createFromUpload(priya, { file: { buffer: Buffer.from(WEAK_RESUME), fileName: "john-carter-resume.txt" }, fields: { title: "John Carter, first draft" } }, META);
  const pm = pick("product", "mid");
  await createFromDocument(priya, { document: pm.doc, templateId: pm.template }, META);
  await tailor(priya, tailored.id, { jd: "Staff platform engineer: Go, Terraform and incident response.", company: "Northwind Systems" }, META);
  await settle(priya.id);
  const draft = pick("designer", "mid");
  await db.insertInto("resume_drafts").values({ id: newId(), user_id: priya.id, name: "UX portfolio draft", template_id: draft.template, document: JSON.stringify(draft.doc) }).execute();

  // The others: one or two each, so the admin overview and the quota tiers have something real.
  const data = pick("data", "mid");
  await createFromDocument(leo, { document: data.doc, templateId: data.template, title: "Data analyst" }, META);
  const nurse = pick("nurs", "senior");
  await createFromDocument(leo, { document: nurse.doc, templateId: nurse.template }, META);
  const fresher = pick("frontend", "fresher");
  await createFromDocument(sam, { document: fresher.doc, templateId: fresher.template, title: "Frontend, fresher" }, META);
  const marketing = pick("marketing", "senior");
  await createFromDocument(amara, { document: marketing.doc, templateId: marketing.template }, META);
  for (const p of [leo, sam, amara]) await settle(p.id);
}
