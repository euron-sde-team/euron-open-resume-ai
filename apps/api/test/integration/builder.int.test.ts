/** Builder rendering routes: templates, live HTML preview, PDF/DOCX export. */
import { afterAll, describe, expect, test } from "vitest";
import { TEMPLATE_IDS } from "@open-resume/types";
import { closePdfBrowser, findChromium } from "../../src/services/resume/render";
import { anon, as, createUser } from "./harness";

const document = {
  personal: { fullName: "Grace Hopper", headline: "Rear Admiral", email: "grace@example.com" },
  links: { github: "javascript:alert(1)" },
  summary: "Compilers.",
  experience: [{ title: "Engineer", company: "Navy", start: "1943", end: "1986", bullets: ["Wrote <img src=http://169.254.169.254/x>"] }],
};

afterAll(closePdfBrowser);

describe("GET /api/templates", () => {
  test("requires sign-in and lists the 13 templates", async () => {
    await anon().get("/api/templates").expect(401);
    const u = await createUser();
    const res = await as(u).get("/api/templates").expect(200);
    expect(res.body.map((t: { id: string }) => t.id)).toEqual([...TEMPLATE_IDS]);
    expect(res.body[0]).toEqual({ id: expect.any(String), name: expect.any(String), description: expect.any(String), columns: expect.any(Number), accent: expect.any(String), atsFriendly: expect.any(Boolean) });
  });
});

describe("POST /api/builder/render", () => {
  test("returns escaped, self-contained HTML with a strict CSP", async () => {
    const u = await createUser();
    const res = await as(u).post("/api/builder/render").send({ document, templateId: "modern_resume_template" }).expect(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.headers["content-security-policy"]).toBe("default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.text).toContain("Grace Hopper");
    expect(res.text).not.toContain("<img src=http");
    expect(res.text).not.toMatch(/javascript:/i);
  });
  test("requires sign-in and validates the body", async () => {
    await anon().post("/api/builder/render").send({ document, templateId: "modern_resume_template" }).expect(401);
    const u = await createUser();
    await as(u).post("/api/builder/render").send({ document, templateId: "../../etc/passwd" }).expect(400);
    await as(u).post("/api/builder/render").send({ document: "x", templateId: "resume_template" }).expect(400);
    await as(u).post("/api/builder/render").send({ document, templateId: "resume_template", extra: 1 }).expect(400);
  });
  test("a body over 512 KB is 413", async () => {
    const u = await createUser();
    const big = { personal: { fullName: "A" }, summary: "x".repeat(600 * 1024) };
    await as(u).post("/api/builder/render").send({ document: big, templateId: "resume_template" }).expect(413);
  });
});

describe("POST /api/builder/export", () => {
  test("docx download", async () => {
    const u = await createUser();
    const res = await as(u).post("/api/builder/export").send({ document, templateId: "resume_template", format: "docx" }).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on("data", (c: Buffer) => chunks.push(c));
      r.on("end", () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    expect(res.headers["content-disposition"]).toBe('attachment; filename="grace-hopper.docx"');
    expect((res.body as Buffer).subarray(0, 2).toString("latin1")).toBe("PK");
  });
  test.skipIf(!findChromium())("pdf download", async () => {
    const u = await createUser();
    const res = await as(u).post("/api/builder/export").send({ document, templateId: "simply_blue_resume_template", format: "pdf" }).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on("data", (c: Buffer) => chunks.push(c));
      r.on("end", () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect((res.body as Buffer).subarray(0, 4).toString("latin1")).toBe("%PDF");
  }, 60_000);
  test("rejects a bad format", async () => {
    const u = await createUser();
    await as(u).post("/api/builder/export").send({ document, templateId: "resume_template", format: "exe" }).expect(400);
  });
});
