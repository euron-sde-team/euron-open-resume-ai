// A stand-in for the Resume AI API contract, for running the web app and taking screenshots
// without the real API:  node apps/web/test/mock-api.mjs   (listens on :5106, in memory).
// Not used by the unit tests or the end-to-end suite.
import http from "node:http";

const PORT = Number(process.env.MOCK_PORT || 5106);
const now = () => new Date().toISOString();
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
let seq = 100;
const id = () => `01J${String(++seq).padStart(23, "0")}`;
const user = { id: "01J00000000000000000000001", username: "priya", displayName: "Priya Nair", role: "USER", email: "priya.nair@example.com", status: "ACTIVE", suspendedUntil: null, emailVerified: true, totpEnabled: false, deletionRequestedAt: null, canOpenAdmin: false };
const usage = { runs: { used: Number(process.env.MOCK_USED || 4), limit: 10, resetsAt: "2026-12-01T00:00:00.000Z" }, resumes: { count: 3, limit: 20 }, maxUploadMb: 5, tier: { id: "free", name: "Free" } };

const doc = {
  personal: { fullName: "Priya Nair", headline: "Senior Backend Engineer", email: "priya.nair@example.com", phone: "+1 555 0100", location: "Austin, TX" },
  links: { github: "https://example.com/priya", linkedin: "linkedin.com/in/priya-nair" },
  summary: "Backend engineer with eight years building payment and messaging systems that stay up under load.",
  experience: [
    { title: "Senior Backend Engineer", company: "Northwind Payments", location: "Austin, TX", start: "2021", end: "Present", bullets: ["Cut p95 checkout latency from 480 ms to 190 ms by moving fraud scoring off the hot path.", "Led a team of four through a zero-downtime move from a monolith to services."] },
    { title: "Software Engineer", company: "Lumen Labs", start: "2017", end: "2021", bullets: ["Built the webhook delivery system used by 300 integrators."] },
  ],
  education: [{ degree: "B.S. Computer Science", institution: "Calder Bay University", start: "2013", end: "2017" }],
  skills: [{ category: "Languages", items: ["Go", "TypeScript", "SQL"] }, { category: "Infrastructure", items: ["Postgres", "Kafka", "Kubernetes"] }],
  projects: [{ name: "Ledgerline", description: "An open source double-entry ledger library.", link: "https://example.com/ledgerline", tech: ["Go", "Postgres"], bullets: ["Used in three production systems."] }],
};
const KINDS = ["analysis", "rewrite", "interview_non_technical", "interview_dsa", "interview_programming", "interview_system_design", "roadmap", "projects"];
const comps = (over = {}) => Object.fromEntries(KINDS.map((k) => [k, { status: over[k] ?? "pending", updatedAt: now() }]));
const report = (score, extra = {}) => ({ score, summary: "Clear impact numbers and a strong recent role. The skills section is thin and two bullets repeat the same verb.", keywords: { matched: ["Go", "Postgres", "Kafka", "Kubernetes"], missing: ["gRPC", "Terraform", "OpenTelemetry"], notes: "Add the missing terms only where you have used them." }, formatting: "Single column, consistent dates, readable at a glance.", content: "Bullets lead with outcomes. The earliest role has one bullet; add scope.", readability: { score: score + 4, notes: "Short sentences. Avoid the repeated opener Led." }, strengths: ["Quantified results in the latest role", "Consistent tense and dates"], weaknesses: ["Skills section lacks cloud tooling", "No links to shipped work beyond one project"], repetitivePhrases: ["Led", "Built"], improvements: ["Add scope and a number to the Lumen Labs role", "Group skills by what you use daily", "Mention on-call or reliability work"], ...extra });

const resumes = new Map();
function add(r) {
  resumes.set(r.id, r);
  return r;
}
const base = (o) => ({ title: "Priya Nair", source: "upload", isTailored: false, templateId: "modern_resume_template", createdAt: now(), updatedAt: now(), fileName: "priya-nair.pdf", ...o });
add({ ...base({ id: "R-DONE", title: "Priya Nair, Backend", company: "Northwind", score: 82 }), status: "analyzed", polls: 99, jd: "Senior backend engineer for payments.", components: comps({ analysis: "done", rewrite: "done", interview_non_technical: "done" }), original: doc, improved: doc, analysis: { before: report(64), after: report(82, { improvements: [] }) }, coverLetter: { header: { name: "Priya Nair", email: "priya.nair@example.com" , company: "Northwind"}, greeting: "Dear hiring team,", paragraphs: ["I have spent eight years building payment systems that stay up under load, most recently cutting checkout latency by 60 percent at Northwind Payments.", "I would like to bring that to your platform team."], closing: "Sincerely,\nPriya Nair" }, interview: { non_technical: [{ title: "Behavioural", items: [{ question: "Tell me about a time you led a risky migration.", answer: "Use the STAR shape.\n\n- Situation: monolith on one database\n- Action: strangler pattern with `dual writes`\n- Result: zero downtime" }, { question: "How do you handle disagreement in design review?", answer: "Write the options down and name the tradeoffs." }] }] } });
add({ ...base({ id: "R-WORK", title: "Marketing resume", fileName: "marketing.docx", updatedAt: new Date(Date.now() - 3600e3).toISOString() }), status: "queued", polls: 0, components: comps() });
add({ ...base({ id: "R-ERR", title: "Old scan", fileName: "scan.pdf", updatedAt: new Date(Date.now() - 86400e3 * 3).toISOString() }), status: "error", polls: 99, components: comps({ analysis: "failed" }) });
add({ ...base({ id: "R-BUILT", title: "Built in chat", source: "builder", fileName: undefined, score: 71, updatedAt: new Date(Date.now() - 86400e3).toISOString() }), status: "analyzed", polls: 99, components: comps({ analysis: "done", rewrite: "done" }), improved: doc, analysis: { before: report(58), after: report(71) } });

function summary(r) {
  const hidden = new Set(["polls", "components", "original", "improved", "analysis", "coverLetter", "interview", "roadmap", "projects", "jd"]);
  return Object.fromEntries(Object.entries(r).filter(([k]) => !hidden.has(k)));
}
function tick(r) {
  if (r.polls >= 99) return;
  r.polls += 1;
  if (r.polls < 2) r.status = "queued";
  else if (r.polls < 4) {
    r.status = "processing";
    r.components = comps({ analysis: "processing" });
  } else {
    Object.assign(r, { status: "analyzed", score: 78, improved: doc, original: doc, analysis: { before: report(61), after: report(78) }, components: comps({ analysis: "done", rewrite: "done" }), polls: 99 });
  }
}
const drafts = new Map([["D1", { id: "D1", name: "Backend resume", templateId: "modern_resume_template", document: doc, createdAt: now(), updatedAt: now() }]]);

function html(d) {
  const p = d.personal || {};
  const exp = (d.experience || []).map((e) => `<h3>${esc(e.title)}, ${esc(e.company)} <small>${esc(e.start)} to ${esc(e.end)}</small></h3><ul>${(e.bullets || []).map((b) => `<li>${esc(b)}</li>`).join("")}</ul>`).join("");
  const skills = (d.skills || []).map((s) => `<p><b>${esc(s.category)}:</b> ${esc((s.items || []).join(", "))}</p>`).join("");
  return `<!doctype html><meta charset="utf-8"><style>body{font:14px/1.5 Georgia,serif;margin:56px;color:#111;width:704px}h1{font-size:30px;margin:0}h2{font-size:12px;letter-spacing:.12em;text-transform:uppercase;border-bottom:1px solid #999;margin:22px 0 8px}h3{font-size:14px;margin:12px 0 2px}small{font-weight:400;color:#555}ul{margin:4px 0;padding-left:18px}</style><h1>${esc(p.fullName)}</h1><div>${esc(p.headline)} &middot; ${esc(p.email)} &middot; ${esc(p.location)}</div><h2>Summary</h2><p>${esc(d.summary)}</p><h2>Experience</h2>${exp}<h2>Skills</h2>${skills}`;
}

function readBody(req) {
  return new Promise((res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      try {
        res(JSON.parse(raw));
      } catch {
        res({});
      }
    });
  });
}
const send = (res, status, body, type = "application/json") => {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(body === undefined ? "" : type === "application/json" ? JSON.stringify(body) : body);
};

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const path = url.pathname.replace(/^\/api/, "");
    const m = req.method;
    const body = m === "POST" || m === "PUT" ? await readBody(req) : {};
    if (path === "/auth/refresh") return send(res, 200, { accessToken: "mock", expiresIn: 900, user });
    if (path === "/auth/me" || path === "/users/me") return send(res, 200, user);
    if (path === "/meta") return send(res, 200, { appName: "Resume AI", tagline: "", registration: "OPEN", features: {}, limits: { maxUploadMb: 5 }, support: { email: null }, minSupportedVersion: null });
    if (path === "/me/usage") return send(res, 200, usage);
    if (path === "/me/preferences") return send(res, 200, { defaultTemplate: null });
    if (path === "/templates") {
      const ids = ["resume_template", "antique_resume_template", "corporate_resume_template", "executive_resume_template", "minimalist_resume_template", "modern_resume_template", "multi_column_resume_template", "obsidian_edge_resume_template", "sage_multi_column_resume_template", "simply_blue_resume_template", "charcoal_glow_template", "orangewhite_modern_template", "entry_level_template"];
      return send(res, 200, ids.map((tid, i) => ({ id: tid, name: tid.replace(/_?(resume_)?template$/, "").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) || "Classic", description: "", columns: i % 3 === 0 ? 2 : 1, accent: "#0f766e", atsFriendly: i % 3 !== 0 })));
    }
    if (path === "/builder/render") return send(res, 200, html(body.document || {}), "text/html");
    if (path === "/builder/export") return send(res, 200, "%PDF-1.4 mock", "application/pdf");
    if (path === "/builder/chat") {
      const last = (body.messages || []).at(-1)?.content || "";
      const d = { ...(body.document || doc) };
      if (!body.document) Object.assign(d, { personal: { fullName: "Alex Rivera", headline: "Product Designer", email: "alex@example.com", location: "Lisbon" }, summary: last.slice(0, 220) });
      return setTimeout(() => send(res, 200, { assistant: "Got it. I added that to your resume.\n\n- Summary updated\n- Next, tell me about your latest role", document: d, nextPrompts: ["Add my most recent job", "Add my education", "Add my skills"] }), 700);
    }
    if (path === "/builder/import") return send(res, 200, { assistant: "I read your file and filled in the sections I could.", document: doc });
    if (path === "/drafts" && m === "GET") return send(res, 200, [...drafts.values()].map((d) => ({ id: d.id, name: d.name, templateId: d.templateId, updatedAt: d.updatedAt })));
    if (path === "/drafts" && m === "POST") {
      const d = { id: id(), name: body.name || "Untitled", templateId: body.templateId || "modern_resume_template", document: body.document || {}, createdAt: now(), updatedAt: now() };
      drafts.set(d.id, d);
      return send(res, 201, d);
    }
    let mm = path.match(/^\/drafts\/([^/]+)$/);
    if (mm) {
      const d = drafts.get(mm[1]);
      if (!d) return send(res, 404, { error: "Not found", code: "NOT_FOUND" });
      if (m === "DELETE") return drafts.delete(d.id), send(res, 204);
      if (m === "PUT") Object.assign(d, body, { updatedAt: now() });
      return send(res, 200, d);
    }
    if (path === "/resumes" && m === "GET") return send(res, 200, { items: [...resumes.values()].map(summary).reverse(), nextCursor: null });
    if (path === "/resumes" && m === "POST") {
      if (usage.runs.used >= usage.runs.limit) return send(res, 429, { error: "Out of runs", code: "QUOTA_EXHAUSTED", details: { limit: usage.runs.limit, used: usage.runs.used, resetsAt: usage.runs.resetsAt } });
      usage.runs.used += 1;
      const r = add({ ...base({ id: id(), title: "Uploaded resume" }), status: "queued", polls: 0, components: comps() });
      return send(res, 202, summary(r));
    }
    if (path === "/resumes/from-document") {
      const r = add({ ...base({ id: id(), title: body.title || "Built in chat", source: "builder", fileName: undefined }), status: "queued", polls: 0, components: comps() });
      return send(res, 202, summary(r));
    }
    mm = path.match(/^\/resumes\/([^/]+)(?:\/([^/]+)(?:\/(.+))?)?$/);
    if (mm) {
      const r = resumes.get(mm[1]);
      if (!r) return send(res, 404, { error: "Not found", code: "NOT_FOUND" });
      const [, , sub, rest] = mm;
      if (!sub && m === "GET") return send(res, 200, r);
      if (!sub && m === "DELETE") return resumes.delete(r.id), send(res, 204);
      if (sub === "status") {
        tick(r);
        return send(res, 200, { status: r.status, components: r.components, updatedAt: r.updatedAt });
      }
      if (sub === "retry") {
        Object.assign(r, { status: "queued", polls: 0, components: comps() });
        return send(res, 202);
      }
      if (sub === "tailor") {
        const t = add({ ...base({ id: id(), title: `${r.title} (tailored)`, isTailored: true, parentId: r.id, company: body.company }), status: "queued", polls: 0, components: comps() });
        return send(res, 202, summary(t));
      }
      if (sub === "components") {
        r.components[rest] = { status: "processing", updatedAt: now() };
        setTimeout(() => {
          r.components[rest] = { status: "done", updatedAt: now() };
          if (rest === "roadmap") r.roadmap = { targetRole: "Staff Backend Engineer", summary: "Move from owning services to owning platform direction.", phases: [{ title: "Own a cross-team system", timeframe: "Months 1 to 3", goals: ["Lead an RFC end to end", "Run a reliability review"], skills: ["System design", "Mentoring"], resources: ["Designing Data-Intensive Applications"] }], certifications: ["CKA"] };
          else if (rest === "projects") r.projects = [{ title: "Rate limiter service", description: "A distributed token bucket with Redis and a clean API.", difficulty: "intermediate", tech: ["Go", "Redis"], outcomes: ["Handles 10k rps in a benchmark"], resumeBullet: "Built a distributed rate limiter sustaining 10k requests per second." }];
          else r.interview = { ...(r.interview || {}), [rest.replace("interview_", "")]: [{ title: "Core questions", items: [{ question: "Explain how you would shard a ledger.", answer: "Start from the access pattern.\n\n```go\nshard := hash(accountID) % n\n```" }] }] };
        }, 2500);
        usage.runs.used += 1;
        return send(res, 202);
      }
      if (sub === "render") return send(res, 200, html(r.improved || doc), "text/html");
      if (sub === "download") return send(res, 200, "%PDF-1.4 mock", "application/pdf");
    }
    send(res, 404, { error: "Not found", code: "NOT_FOUND" });
  })
  .listen(PORT, () => console.log(`mock api on :${PORT}`));
