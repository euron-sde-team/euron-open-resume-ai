import { describe, expect, it, vi } from "vitest";
import { buildUploadForm, createApiClient, ON_DEMAND_KINDS } from "../src";
import { json } from "./fixtures";

function setup(respond: (url: string, init: RequestInit) => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return respond(String(url), init ?? {});
  });
  const client = createApiClient({ baseUrl: "https://app.example.com/api", getAccessToken: () => "tok", fetch: fetch as unknown as typeof globalThis.fetch });
  return { client, calls };
}

const body = (c: { init: RequestInit }) => JSON.parse(String(c.init.body));

describe("resume endpoints", () => {
  it("lists with a cursor and reads one resume and its status", async () => {
    const { client, calls } = setup(() => json(200, { items: [], nextCursor: null }));
    await client.resumes.list({ cursor: "abc", limit: 20 });
    await client.resumes.get("R 1");
    await client.resumes.status("R1");
    expect(calls.map((c) => c.url)).toEqual([
      "https://app.example.com/api/resumes?cursor=abc&limit=20",
      "https://app.example.com/api/resumes/R%201",
      "https://app.example.com/api/resumes/R1/status",
    ]);
    expect(calls[0]!.init.method).toBe("GET");
  });

  it("posts retry with and without a component, tailor and on-demand generation", async () => {
    const { client, calls } = setup(() => json(202, {}));
    await client.resumes.retry("R1");
    await client.resumes.retry("R1", "analysis");
    await client.resumes.tailor("R1", { jd: "Backend role", company: "Acme" });
    await client.resumes.generate("R1", "roadmap");
    expect(calls[0]!.url).toMatch(/\/resumes\/R1\/retry$/);
    expect(body(calls[0]!)).toEqual({});
    expect(body(calls[1]!)).toEqual({ component: "analysis" });
    expect(calls[2]!.url).toMatch(/\/resumes\/R1\/tailor$/);
    expect(body(calls[2]!)).toEqual({ jd: "Backend role", company: "Acme" });
    expect(calls[3]!.url).toMatch(/\/resumes\/R1\/components\/roadmap$/);
    expect(calls[3]!.init.method).toBe("POST");
  });

  it("deletes a resume", async () => {
    const { client, calls } = setup(() => new Response(null, { status: 204 }));
    await client.resumes.remove("R1");
    expect(calls[0]!.init.method).toBe("DELETE");
  });

  it("downloads a file, passing the template for a re-render", async () => {
    const { client, calls } = setup(() => new Response("%PDF", { status: 200 }));
    const blob = await client.resumes.download("R1", "resume.pdf", "modern_resume_template");
    expect(await blob.text()).toBe("%PDF");
    expect(calls[0]!.url).toBe("https://app.example.com/api/resumes/R1/download/resume.pdf?template=modern_resume_template");
    await client.resumes.download("R1", "original");
    expect(calls[1]!.url).toBe("https://app.example.com/api/resumes/R1/download/original");
  });

  it("fetches rendered html as text", async () => {
    const { client, calls } = setup(() => new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } }));
    expect(await client.resumes.render("R1", "resume_template")).toBe("<html></html>");
    expect(calls[0]!.url).toContain("/resumes/R1/render?template=resume_template");
  });

  it("builds the upload form without blank optional fields", () => {
    const form = buildUploadForm({ file: new File(["x"], "cv.pdf", { type: "application/pdf" }), jd: "  ", company: " Acme ", templateId: "modern_resume_template" });
    expect(form.get("file")).toBeInstanceOf(File);
    expect(form.get("jd")).toBeNull();
    expect(form.get("company")).toBe("Acme");
    expect(form.get("templateId")).toBe("modern_resume_template");
  });

  it("covers every on-demand component the contract lists", () => {
    expect([...ON_DEMAND_KINDS].sort()).toEqual(["interview_dsa", "interview_non_technical", "interview_programming", "interview_system_design", "projects", "roadmap"]);
  });
});

describe("templates and builder", () => {
  it("lists templates", async () => {
    const { client, calls } = setup(() => json(200, [{ id: "resume_template" }]));
    expect(await client.templates.list()).toHaveLength(1);
    expect(calls[0]!.url).toMatch(/\/templates$/);
  });

  it("renders a preview and exports a file", async () => {
    const { client, calls } = setup((url) => (url.endsWith("/builder/render") ? new Response("<p>hi</p>", { headers: { "content-type": "text/html" } }) : new Response("PK", { status: 200 })));
    expect(await client.builder.render({ summary: "s" }, "resume_template")).toBe("<p>hi</p>");
    expect(body(calls[0]!)).toEqual({ document: { summary: "s" }, templateId: "resume_template" });
    const blob = await client.builder.export({ summary: "s" }, "resume_template", "docx");
    expect(await blob.text()).toBe("PK");
    expect(body(calls[1]!)).toMatchObject({ format: "docx" });
  });

  it("sends a chat turn", async () => {
    const { client, calls } = setup(() => json(200, { assistant: "ok", document: {}, nextPrompts: [] }));
    const r = await client.builder.chat({ messages: [{ role: "user", content: "hi" }] });
    expect(r.assistant).toBe("ok");
    expect(calls[0]!.url).toMatch(/\/builder\/chat$/);
  });
});

describe("drafts", () => {
  it("accepts a bare list or a page", async () => {
    const a = setup(() => json(200, [{ id: "D1" }]));
    expect(await a.client.drafts.list()).toHaveLength(1);
    const b = setup(() => json(200, { items: [{ id: "D1" }, { id: "D2" }], nextCursor: null }));
    expect(await b.client.drafts.list()).toHaveLength(2);
  });

  it("creates, updates and deletes", async () => {
    const { client, calls } = setup((_u, init) => (init.method === "DELETE" ? new Response(null, { status: 204 }) : json(200, { id: "D1" })));
    await client.drafts.create({ name: "A", document: {} });
    await client.drafts.update("D1", { name: "B", document: {} });
    await client.drafts.remove("D1");
    expect(calls.map((c) => c.init.method)).toEqual(["POST", "PUT", "DELETE"]);
    expect(calls[1]!.url).toMatch(/\/drafts\/D1$/);
  });
});
