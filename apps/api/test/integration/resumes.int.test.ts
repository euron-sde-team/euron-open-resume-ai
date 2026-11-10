/**
 * The resume core over HTTP against the test database: upload validation, the pipeline
 * (with fake AI tasks), quotas, retry, tailor, components, delete, download, render,
 * drafts, usage and the account lifecycle. Every test that touches another user's id
 * expects a 404.
 */
import type { ResumeDetail, ResumeSummary, Usage } from "@open-resume/types";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { withTransaction } from "../../src/core/effects";
import { db } from "../../src/db/kysely";
import { storage } from "../../src/integrations/storage";
import { registerJob } from "../../src/jobs/registry";
import { anonymiseUser } from "../../src/services/account.service";
import { resetResumeDeps, setResumeDeps } from "../../src/services/resume/deps";
import { runResumeJob } from "../../src/services/resume/pipeline";
import { fakeAi, fakeRenderer, RESUME_TEXT } from "../support/fakes";
import { as, createUser, type TestUser } from "./harness";

const ai = fakeAi();
const renderer = fakeRenderer();
setResumeDeps({ ai: ai.tasks, renderer });
afterAll(() => resetResumeDeps());
beforeEach(() => {
  ai.calls.length = 0;
  ai.state.failAnalyze = 0;
  ai.state.failAlways = false;
});

async function setOverride(user: TestUser, values: { monthly_runs?: number | null; max_resumes?: number | null; max_upload_mb?: number | null }) {
  await db.insertInto("user_quota_overrides").values({ user_id: user.id, ...values }).onConflict((oc) => oc.column("user_id").doUpdateSet(values)).execute();
}

function upload(user: TestUser, over: { name?: string; body?: Buffer | string; fields?: Record<string, string> } = {}) {
  let req = as(user).post("/api/resumes").attach("file", Buffer.from(over.body ?? RESUME_TEXT), over.name ?? "ada-cv.txt");
  for (const [k, v] of Object.entries(over.fields ?? {})) req = req.field(k, v);
  return req;
}

const detail = async (user: TestUser, id: string) => (await as(user).get(`/api/resumes/${id}`).expect(200)).body as ResumeDetail;
const usage = async (user: TestUser) => (await as(user).get("/api/me/usage").expect(200)).body as Usage;

async function uploaded(user: TestUser) {
  const res = await upload(user).expect(202);
  return res.body as ResumeSummary;
}

describe("upload and the pipeline", () => {
  test("a text upload is stored, analysed, charged once and gets the default interview set", async () => {
    const ada = await createUser();
    const summary = await uploaded(ada);
    expect(summary).toMatchObject({ source: "upload", fileName: "ada-cv.txt", title: "ada cv", isTailored: false, status: "analyzed", score: 81 });

    const d = await detail(ada, summary.id);
    expect(d.original?.personal?.fullName).toBe("Ada Lovelace");
    expect(d.improved?.summary).toBe("improved");
    expect(d.analysis?.after.score).toBe(81.4);
    expect(d.coverLetter?.paragraphs).toEqual(["Dear team"]);
    expect(d.interview?.non_technical?.[0]?.title).toBe("non_technical");
    expect(d.components.analysis.status).toBe("done");
    expect(d.components.rewrite.status).toBe("done");
    expect(d.components.interview_non_technical.status).toBe("done");
    expect(d.components.roadmap.status).toBe("pending");

    const row = await db.selectFrom("resumes").select(["file_key", "file_mime", "file_size"]).where("id", "=", summary.id).executeTakeFirstOrThrow();
    expect(row.file_key).toBe(`resumes/${ada.id}/${summary.id}/original.txt`);
    expect(await storage().head(row.file_key!)).not.toBeNull();

    const u = await usage(ada);
    expect(u.runs.used).toBe(1);
    expect(u.byKind).toEqual({ analyze: 1 });
    expect(u.resumes.count).toBe(1);
    expect(ai.count("parseDocument")).toBe(1);
    expect(ai.count("analyze")).toBe(1);
    expect(ai.count("interview")).toBe(1);

    const status = (await as(ada).get(`/api/resumes/${summary.id}/status`).expect(200)).body;
    expect(status.status).toBe("analyzed");
    expect(Object.keys(status.components)).toHaveLength(8);
  });

  test("the queue job carries ids only", async () => {
    const ada = await createUser();
    const seen: unknown[] = [];
    registerJob("resume-ai.run", async (data) => {
      seen.push(data);
    });
    try {
      const s = await uploaded(ada);
      expect(seen).toEqual([{ resumeId: s.id, userId: ada.id, component: "analysis" }]);
      expect(JSON.stringify(seen)).not.toContain("Lovelace");
      expect((await detail(ada, s.id)).status).toBe("queued");
    } finally {
      registerJob("resume-ai.run", (data) => runResumeJob(data));
    }
  });

  test("a duplicate delivery of a finished job does nothing", async () => {
    const ada = await createUser();
    const s = await uploaded(ada);
    await runResumeJob({ resumeId: s.id, userId: ada.id, component: "analysis" });
    expect(ai.count("analyze")).toBe(1);
  });

  test("validation: no file, wrong type, scanned file, unknown template, long jd", async () => {
    const ada = await createUser();
    await as(ada).post("/api/resumes").field("jd", "x").expect(400);
    expect((await upload(ada, { body: Buffer.from([0x4d, 0x5a, 0, 0, 1, 2, 3]), name: "cv.txt" }).expect(415)).body.code).toBe("UNSUPPORTED_FILE");
    expect((await upload(ada, { body: "just  \n 1", name: "scan.txt" }).expect(422)).body.code).toBe("NO_TEXT");
    expect((await upload(ada, { fields: { templateId: "../../etc/passwd" } }).expect(400)).body.code).toBe("UNKNOWN_TEMPLATE");
    await upload(ada, { fields: { jd: "j".repeat(20_001) } }).expect(400);
    await as(ada).post("/api/resumes").set("Content-Type", "application/json").send({}).expect(400);
    expect((await usage(ada)).runs.used).toBe(0);
    expect(await db.selectFrom("resumes").select("id").where("user_id", "=", ada.id).execute()).toHaveLength(0);
  });

  test("the file name never decides the stored path", async () => {
    const ada = await createUser();
    const s = (await upload(ada, { name: "../../../evil.txt" }).expect(202)).body as ResumeSummary;
    const row = await db.selectFrom("resumes").select(["file_key", "file_name"]).where("id", "=", s.id).executeTakeFirstOrThrow();
    expect(row.file_key).toBe(`resumes/${ada.id}/${s.id}/original.txt`);
    expect(row.file_name).toBe("evil.txt");
  });

  test("the tier's max_upload_mb is enforced with 413", async () => {
    const ada = await createUser();
    await setOverride(ada, { max_upload_mb: 1 });
    const big = Buffer.from("word ".repeat(300_000));
    const res = await upload(ada, { body: big }).expect(413);
    expect(res.body.code).toBe("FILE_TOO_LARGE");
    expect((await usage(ada)).runs.used).toBe(0);
  });

  test("from-document starts a builder resume from the normalised document", async () => {
    const ada = await createUser();
    const res = await as(ada)
      .post("/api/resumes/from-document")
      .send({ document: { personal: { fullName: "  Grace  " }, summary: "Compilers", links: { github: "javascript:alert(1)" } }, jd: "Build compilers", company: "Navy" })
      .expect(202);
    expect(res.body).toMatchObject({ source: "builder", title: "Grace", company: "Navy", status: "analyzed" });
    const d = await detail(ada, res.body.id);
    expect(d.original).toEqual({ personal: { fullName: "Grace" }, summary: "Compilers" });
    expect(ai.count("parseDocument")).toBe(0);
    expect(ai.calls.find((c) => c.fn === "analyze")!.args[1]).toEqual({ jd: "Build compilers", company: "Navy" });
    await as(ada).post("/api/resumes/from-document").send({ document: {} }).expect(422);
    await as(ada).post("/api/resumes/from-document").send({ document: "x" }).expect(400);
  });
});

describe("quotas", () => {
  test("monthly runs: the next upload after the limit is 429 QUOTA_EXHAUSTED and charges nothing", async () => {
    const ada = await createUser();
    await setOverride(ada, { monthly_runs: 1 });
    await uploaded(ada);
    const res = await upload(ada).expect(429);
    expect(res.body).toMatchObject({ code: "QUOTA_EXHAUSTED", details: { limit: 1, used: 1 } });
    expect(res.body.details.resetsAt).toMatch(/-01T00:00:00/);
    expect((await usage(ada)).runs.used).toBe(1);
    expect(await db.selectFrom("resumes").select("id").where("user_id", "=", ada.id).execute()).toHaveLength(1);
  });

  test("the resume cap is 409 RESUME_LIMIT", async () => {
    const ada = await createUser();
    await setOverride(ada, { max_resumes: 1 });
    await uploaded(ada);
    const res = await upload(ada).expect(409);
    expect(res.body.code).toBe("RESUME_LIMIT");
    expect((await usage(ada)).runs.used).toBe(1);
  });

  test("/api/me/usage has the contract shape", async () => {
    const ada = await createUser();
    const u = await usage(ada);
    expect(u).toMatchObject({ runs: { used: 0, limit: 20 }, resumes: { count: 0, limit: 10 }, maxUploadMb: 10 });
    expect(u.runs.resetsAt).toBe(u.resetsAt);
    expect(u.tier).toMatchObject({ name: expect.any(String) });
  });
});

describe("failures, retry and refunds", () => {
  test("three failed attempts mark the resume errored, give the run back and hide provider detail", async () => {
    const ada = await createUser();
    ai.state.failAlways = true;
    const s = await uploaded(ada);
    expect(ai.count("analyze")).toBe(3);
    const d = await detail(ada, s.id);
    expect(d.status).toBe("error");
    expect(d.components.analysis).toMatchObject({ status: "failed" });
    expect(JSON.stringify(d)).not.toContain("SECRET-PROVIDER-DETAIL");
    expect(d.components.interview_non_technical.status).toBe("pending");
    expect((await usage(ada)).runs.used).toBe(0);

    ai.state.failAlways = false;
    const retried = await as(ada).post(`/api/resumes/${s.id}/retry`).send({}).expect(202);
    expect(retried.body.status).toBe("analyzed");
    expect(ai.count("parseDocument")).toBe(1);
    expect((await detail(ada, s.id)).components.interview_non_technical.status).toBe("done");
    expect((await usage(ada)).runs.used).toBe(1);
  });

  test("a transient failure is retried and succeeds without a refund", async () => {
    const ada = await createUser();
    ai.state.failAnalyze = 2;
    const s = await uploaded(ada);
    expect(ai.count("analyze")).toBe(3);
    expect(s.status).toBe("analyzed");
    expect((await usage(ada)).runs.used).toBe(1);
  });

  test("retry: nothing failed is 409, a healthy step cannot be retried, unknown component is 400", async () => {
    const ada = await createUser();
    const s = await uploaded(ada);
    expect((await as(ada).post(`/api/resumes/${s.id}/retry`).send({}).expect(409)).body.code).toBe("NOTHING_TO_RETRY");
    expect((await as(ada).post(`/api/resumes/${s.id}/retry`).send({ component: "analysis" }).expect(409)).body.code).toBe("NOT_FAILED");
    await as(ada).post(`/api/resumes/${s.id}/retry`).send({ component: "bogus" }).expect(400);
  });

  test("a retry over the quota is refused", async () => {
    const ada = await createUser();
    await setOverride(ada, { monthly_runs: 1 });
    ai.state.failAlways = true;
    const s = await uploaded(ada);
    await uploaded(ada); // takes the single run (also fails and refunds)
    ai.state.failAlways = false;
    await db.insertInto("usage_monthly").values({ user_id: ada.id, month: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)), kind: "analyze", runs: 1 }).onConflict((oc) => oc.doNothing()).execute();
    await db.updateTable("usage_monthly").set({ runs: 1 }).where("user_id", "=", ada.id).execute();
    expect((await as(ada).post(`/api/resumes/${s.id}/retry`).send({}).expect(429)).body.code).toBe("QUOTA_EXHAUSTED");
  });

  test("a component that lost its job is failed and refunded when read", async () => {
    const ada = await createUser();
    const s = await uploaded(ada);
    await db.insertInto("resume_components").values({ resume_id: s.id, kind: "roadmap", status: "processing", charged: 1, updated_at: new Date(Date.now() - 3600_000) }).execute();
    await as(ada).get(`/api/resumes/${s.id}/status`).expect(200);
    const d = await detail(ada, s.id);
    expect(d.components.roadmap.status).toBe("failed");
    const row = await db.selectFrom("resume_components").select("charged").where("resume_id", "=", s.id).where("kind", "=", "roadmap").executeTakeFirstOrThrow();
    expect(row.charged).toBe(0);
  });
});

describe("tailor and components", () => {
  test("tailor makes a new resume with a copied file and the new job description", async () => {
    const ada = await createUser();
    const parent = await uploaded(ada);
    ai.calls.length = 0;
    const res = await as(ada).post(`/api/resumes/${parent.id}/tailor`).send({ jd: "We need a Rust engineer", company: "Acme" }).expect(202);
    const child = res.body as ResumeSummary;
    expect(child).toMatchObject({ isTailored: true, parentId: parent.id, company: "Acme", status: "analyzed" });
    expect(child.id).not.toBe(parent.id);
    expect(child.title).toBe("ada cv (tailored for Acme)");
    const keys = await db.selectFrom("resumes").select(["id", "file_key"]).where("id", "in", [parent.id, child.id]).execute();
    expect(new Set(keys.map((k) => k.file_key)).size).toBe(2);
    for (const k of keys) expect(await storage().head(k.file_key!)).not.toBeNull();
    // The parent's parsed document is reused: no second parse, one analyze with the new job.
    expect(ai.count("parseDocument")).toBe(0);
    expect(ai.calls.find((c) => c.fn === "analyze")!.args[1]).toEqual({ jd: "We need a Rust engineer", company: "Acme" });
    expect((await usage(ada)).runs.used).toBe(2);
    await as(ada).post(`/api/resumes/${parent.id}/tailor`).send({ jd: "" }).expect(400);
  });

  test("on-demand components cost one run each and fill the detail", async () => {
    const ada = await createUser();
    const s = await uploaded(ada);
    await as(ada).post(`/api/resumes/${s.id}/components/roadmap`).expect(202);
    await as(ada).post(`/api/resumes/${s.id}/components/projects`).expect(202);
    await as(ada).post(`/api/resumes/${s.id}/components/interview_dsa`).expect(202);
    const d = await detail(ada, s.id);
    expect(d.roadmap?.targetRole).toBe("Staff");
    expect(d.projects).toHaveLength(1);
    expect(d.interview?.dsa).toHaveLength(1);
    expect(d.status).toBe("analyzed");
    const u = await usage(ada);
    expect(u.runs.used).toBe(4);
    expect(u.byKind).toEqual({ analyze: 1, interview: 1, roadmap: 1, projects: 1 });
    expect((await as(ada).post(`/api/resumes/${s.id}/components/analysis`).expect(400)).body.code).toBe("UNKNOWN_COMPONENT");
  });

  test("a component that is already running is 409 and not charged twice", async () => {
    const ada = await createUser();
    const s = await uploaded(ada);
    await db.insertInto("resume_components").values({ resume_id: s.id, kind: "roadmap", status: "processing", charged: 1 }).execute();
    const before = (await usage(ada)).runs.used;
    expect((await as(ada).post(`/api/resumes/${s.id}/components/roadmap`).expect(409)).body.code).toBe("ALREADY_RUNNING");
    expect((await usage(ada)).runs.used).toBe(before);
  });

  test("a failed component keeps the resume analysed and can be retried", async () => {
    const ada = await createUser();
    const s = await uploaded(ada);
    const broken = { ...ai.tasks, roadmap: async () => Promise.reject(new Error("boom")) };
    setResumeDeps({ ai: broken });
    await as(ada).post(`/api/resumes/${s.id}/components/roadmap`).expect(202);
    setResumeDeps({ ai: ai.tasks });
    const d = await detail(ada, s.id);
    expect(d.status).toBe("analyzed");
    expect(d.components.roadmap.status).toBe("failed");
    expect((await usage(ada)).runs.used).toBe(1);
    await as(ada).post(`/api/resumes/${s.id}/retry`).send({ component: "roadmap" }).expect(202);
    expect((await detail(ada, s.id)).components.roadmap.status).toBe("done");
  });
});

describe("list, delete, ownership", () => {
  test("lists newest first with a cursor, only the caller's", async () => {
    const ada = await createUser();
    const bob = await createUser();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await uploaded(ada)).id);
    await uploaded(bob);
    const first = (await as(ada).get("/api/resumes?limit=2").expect(200)).body;
    expect(first.items.map((r: ResumeSummary) => r.id)).toEqual([ids[2], ids[1]]);
    expect(first.nextCursor).toBeTruthy();
    const second = (await as(ada).get(`/api/resumes?limit=2&cursor=${first.nextCursor}`).expect(200)).body;
    expect(second.items.map((r: ResumeSummary) => r.id)).toEqual([ids[0]]);
    expect(second.nextCursor).toBeNull();
    await as(ada).get("/api/resumes?cursor=garbage").expect(400);
    await as(null).get("/api/resumes").expect(401);
  });

  test("someone else's resume is a 404 on every route", async () => {
    const ada = await createUser();
    const eve = await createUser();
    const s = await uploaded(ada);
    const id = s.id;
    await as(eve).get(`/api/resumes/${id}`).expect(404);
    await as(eve).get(`/api/resumes/${id}/status`).expect(404);
    await as(eve).post(`/api/resumes/${id}/retry`).send({}).expect(404);
    await as(eve).post(`/api/resumes/${id}/tailor`).send({ jd: "x" }).expect(404);
    await as(eve).post(`/api/resumes/${id}/components/roadmap`).expect(404);
    await as(eve).get(`/api/resumes/${id}/download/original`).expect(404);
    await as(eve).get(`/api/resumes/${id}/download/resume.pdf`).expect(404);
    await as(eve).get(`/api/resumes/${id}/render`).expect(404);
    await as(eve).delete(`/api/resumes/${id}`).expect(404);
    await as(eve).get(`/api/resumes/not-an-id`).expect(400);
    expect((await detail(ada, id)).id).toBe(id);
    expect((await usage(eve)).runs.used).toBe(0);
  });

  test("delete removes rows, components and the stored file, and is audited", async () => {
    const ada = await createUser();
    const parent = await uploaded(ada);
    const child = (await as(ada).post(`/api/resumes/${parent.id}/tailor`).send({ jd: "job" }).expect(202)).body as ResumeSummary;
    const keys = await db.selectFrom("resumes").select(["id", "file_key"]).where("user_id", "=", ada.id).execute();
    await as(ada).delete(`/api/resumes/${parent.id}`).expect(204);
    const parentKey = keys.find((k) => k.id === parent.id)!.file_key!;
    expect(await storage().head(parentKey)).toBeNull();
    expect(await db.selectFrom("resume_components").select("kind").where("resume_id", "=", parent.id).execute()).toHaveLength(0);
    await as(ada).get(`/api/resumes/${parent.id}`).expect(404);
    await as(ada).delete(`/api/resumes/${parent.id}`).expect(404);
    const survivor = await detail(ada, child.id);
    expect(survivor.parentId).toBeUndefined();
    expect(await storage().head(keys.find((k) => k.id === child.id)!.file_key!)).not.toBeNull();
    const logged = await db.selectFrom("audit_log").select("action").where("entity_id", "=", parent.id).execute();
    expect(logged.map((l) => l.action)).toEqual(expect.arrayContaining(["resume.create", "resume.delete"]));
  });
});

describe("download and render", () => {
  test("original streams the uploaded bytes as an attachment, no-store", async () => {
    const ada = await createUser();
    const s = await uploaded(ada);
    const res = await as(ada).get(`/api/resumes/${s.id}/download/original`).buffer(true).expect(200);
    expect(res.headers["content-disposition"]).toContain('attachment; filename="ada-cv.txt"');
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.text ?? res.body.toString()).toContain("Ada Lovelace");
  });

  test("rendered files come from the renderer; ?template re-renders with another template", async () => {
    const ada = await createUser();
    const s = await uploaded(ada);
    const pdf = await as(ada).get(`/api/resumes/${s.id}/download/resume.pdf?template=simply_blue_resume_template`).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on("data", (c: Buffer) => chunks.push(c));
      r.on("end", () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    expect(pdf.body.toString()).toBe("%PDF-fake simply_blue_resume_template");
    expect(pdf.headers["content-disposition"]).toMatch(/^attachment; filename="ada-cv\.pdf"/);
    expect(pdf.headers["cache-control"]).toBe("no-store");
    await as(ada).get(`/api/resumes/${s.id}/download/resume.docx`).expect(200);
    await as(ada).get(`/api/resumes/${s.id}/download/cover-letter.pdf`).expect(200);
    await as(ada).get(`/api/resumes/${s.id}/download/cover-letter.docx`).expect(200);
    await as(ada).get(`/api/resumes/${s.id}/download/secrets.txt`).expect(404);
  });

  test("a resume that is not analysed yet is 409 NOT_READY; a builder resume has no original file", async () => {
    const ada = await createUser();
    const seen: unknown[] = [];
    registerJob("resume-ai.run", async (d) => void seen.push(d));
    try {
      const s = await uploaded(ada);
      expect((await as(ada).get(`/api/resumes/${s.id}/download/resume.pdf`).expect(409)).body.code).toBe("NOT_READY");
      expect((await as(ada).get(`/api/resumes/${s.id}/render`).expect(409)).body.code).toBe("NOT_READY");
    } finally {
      registerJob("resume-ai.run", (data) => runResumeJob(data));
    }
    const b = (await as(ada).post("/api/resumes/from-document").send({ document: { summary: "hi" } }).expect(202)).body;
    await as(ada).get(`/api/resumes/${b.id}/download/original`).expect(404);
  });

  test("render returns HTML under a locked-down CSP", async () => {
    const ada = await createUser();
    const s = await uploaded(ada);
    const res = await as(ada).get(`/api/resumes/${s.id}/render?template=corporate_resume_template`).expect(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.text).toContain("resume corporate_resume_template");
    const csp = res.headers["content-security-policy"] as string;
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("style-src 'unsafe-inline'");
    expect(csp).toContain("img-src data:");
    expect(csp).toContain("sandbox");
    expect(res.headers["cache-control"]).toBe("no-store");
  });
});

describe("drafts", () => {
  test("create, list, read, update, delete with a normalised document", async () => {
    const ada = await createUser();
    const created = (await as(ada).post("/api/drafts").send({ name: "  My CV ", templateId: "simply_blue_resume_template", document: { personal: { fullName: " Ada " }, links: { github: "javascript:x" } } }).expect(201)).body;
    expect(created).toMatchObject({ name: "My CV", templateId: "simply_blue_resume_template", document: { personal: { fullName: "Ada" } } });
    expect(created.document.links).toBeUndefined();
    const list = (await as(ada).get("/api/drafts").expect(200)).body;
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toEqual({ id: created.id, name: "My CV", templateId: "simply_blue_resume_template", updatedAt: expect.any(String) });
    expect((await as(ada).get(`/api/drafts/${created.id}`).expect(200)).body.document.personal.fullName).toBe("Ada");
    const updated = (await as(ada).put(`/api/drafts/${created.id}`).send({ document: { summary: "new" } }).expect(200)).body;
    expect(updated).toMatchObject({ name: "My CV", document: { summary: "new" } });
    await as(ada).delete(`/api/drafts/${created.id}`).expect(204);
    await as(ada).get(`/api/drafts/${created.id}`).expect(404);
    await as(ada).post("/api/drafts").send({ document: "nope" }).expect(400);
    await as(ada).post("/api/drafts").send({ templateId: "../x", document: {} }).expect(400);
  });

  test("scoped to the owner and capped at 50", async () => {
    const ada = await createUser();
    const eve = await createUser();
    const d = (await as(ada).post("/api/drafts").send({ document: { summary: "s" } }).expect(201)).body;
    await as(eve).get(`/api/drafts/${d.id}`).expect(404);
    await as(eve).put(`/api/drafts/${d.id}`).send({ name: "x" }).expect(404);
    await as(eve).delete(`/api/drafts/${d.id}`).expect(404);
    expect((await as(eve).get("/api/drafts").expect(200)).body.items).toHaveLength(0);

    const { newId } = await import("../../src/core/ids");
    const rows = Array.from({ length: 49 }, () => ({ id: newId(), user_id: ada.id, name: "d", document: "{}" }));
    await db.insertInto("resume_drafts").values(rows).execute();
    const res = await as(ada).post("/api/drafts").send({ document: {} }).expect(409);
    expect(res.body.code).toBe("DRAFT_LIMIT");
  });
});

describe("account lifecycle", () => {
  test("the export includes resumes (without storage keys) and drafts, only the caller's", async () => {
    const ada = await createUser();
    const eve = await createUser();
    await uploaded(ada);
    await uploaded(eve);
    await as(ada).post("/api/drafts").send({ document: { summary: "s" } }).expect(201);
    const data = (await as(ada).get("/api/users/me/export").expect(200)).body;
    expect(data.resumes).toHaveLength(1);
    expect(data.resumes[0]).toMatchObject({ title: "ada cv", components: expect.any(Array) });
    expect(JSON.stringify(data)).not.toContain("file_key");
    expect(JSON.stringify(data)).not.toContain("resumes/");
    expect(data.drafts).toHaveLength(1);
  });

  test("erasing a user removes their resumes, drafts and stored files after commit", async () => {
    const ada = await createUser();
    const s = await uploaded(ada);
    await as(ada).post("/api/drafts").send({ document: { summary: "s" } }).expect(201);
    const key = (await db.selectFrom("resumes").select("file_key").where("id", "=", s.id).executeTakeFirstOrThrow()).file_key!;
    await withTransaction(async (trx, fx) => {
      await anonymiseUser(ada.id, trx, fx);
    });
    expect(await storage().head(key)).toBeNull();
    expect(await db.selectFrom("resumes").select("id").where("user_id", "=", ada.id).execute()).toHaveLength(0);
    expect(await db.selectFrom("resume_drafts").select("id").where("user_id", "=", ada.id).execute()).toHaveLength(0);
  });

  test("request bodies with resume text are not logged", async () => {
    const { REDACT } = await import("../../src/core/logger");
    for (const k of ["document", "jd", "text", "original", "improved"]) expect((REDACT as { paths: string[] }).paths).toEqual(expect.arrayContaining([k, `*.${k}`, `*.*.${k}`]));
  });
});
