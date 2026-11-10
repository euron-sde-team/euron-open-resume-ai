/* global process, Buffer, URL, setTimeout */
/**
 * A deterministic stand-in for an OpenAI-compatible model endpoint, in one dependency-free
 * Node process (node:http). Development, CI and the integration tests run the API's real
 * provider adapter against it: only the base URL differs from production.
 *
 *   POST /v1/chat/completions   streaming (SSE) and not, with `usage`
 *   GET  /v1/models             the one stub model
 *   GET  /__/requests           every recorded request, newest first (bodies, key present or not)
 *   POST /__/reset              clears the record
 *   GET  /up                    health check
 *
 * Resume tasks: when the first system message starts with `[task:<name>]` (parse, rewrite,
 * analysis, analysis_after, interview_non_technical, interview_dsa, interview_programming,
 * interview_system_design, roadmap, projects, chat) it answers that task's canned JSON.
 * Otherwise, what it answers: with
 * `response_format: { type: "json_object" }` it returns the JSON object
 * `{ "stub": true, "echo": "<first 80 characters of the last user message>" }`, otherwise
 * the text `Stub reply: <the same echo>`. Words in the last user message steer it:
 *   "slow"             streams a long answer slowly (cancel and resume tests)
 *   "fail"             answers 500;  "ratelimit" answers 429
 *   "context overflow" answers 400 context_length_exceeded
 * Keys are never checked: any Authorization header is accepted and recorded only as
 * "present" or "absent".
 *
 *   PORT=5199 node server.mjs
 */
import http from "node:http";
import { pathToFileURL } from "node:url";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── HTTP helpers ──────────────────────────────────────────────────────────────

function readBody(req, limit = 30_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("body too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

function sse(res) {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  return {
    data: (obj) => res.write(`data: ${typeof obj === "string" ? obj : JSON.stringify(obj)}\n\n`),
    end: () => res.end(),
  };
}

// ─── The model ─────────────────────────────────────────────────────────────────

/** Plain text of the last user message, whatever shape its content has. */
function lastUserText(messages = []) {
  const last = [...messages].reverse().find((m) => m.role === "user");
  if (!last) return "";
  if (typeof last.content === "string") return last.content;
  return (last.content ?? []).map((p) => (p.type === "text" ? p.text : "")).join(" ");
}

/** Plain text of the first system message. */
function systemText(messages = []) {
  const sys = messages.find((m) => m.role === "system");
  if (!sys) return "";
  return typeof sys.content === "string" ? sys.content : (sys.content ?? []).map((p) => (p.type === "text" ? p.text : "")).join(" ");
}

/** The resume task named by the `[task:<name>]` marker on the first line of the system prompt. */
export function taskOf(body) {
  return /^\s*\[task:([a-z_]+)\]/.exec(systemText(body.messages))?.[1] ?? null;
}

const STUB_DOC = {
  personal: { fullName: "Stub Candidate", headline: "Software Engineer", email: "stub.candidate@example.com", phone: "+1 555 0100 00", location: "Springfield" },
  links: { github: "https://github.com/example-stub" },
  summary: "Software engineer who ships reliable web services and clear documentation.",
  experience: [{ title: "Software Engineer", company: "Example Works", location: "Springfield", start: "Jan 2021", end: "Present", bullets: ["Built a REST API used by 5 internal teams.", "Reduced build time by 30% with caching."] }],
  education: [{ degree: "B.S. in Computer Science", institution: "Example University", start: "2016", end: "2020" }],
  skills: [{ category: "Languages", items: ["TypeScript", "Python", "SQL"] }],
  projects: [{ name: "Stub Tracker", description: "A small tracker.", tech: ["TypeScript"], bullets: ["Shipped to 40 users."] }],
  certifications: [],
  languages: [{ name: "English", level: "Fluent" }],
  achievements: [],
};

const stubReport = (score, after) => ({
  score,
  summary: after ? "The rewrite is clearer and more specific." : "A reasonable base with room to quantify results.",
  keywords: { matched: ["typescript", "sql"], missing: after ? [] : ["docker"], notes: "Stub keywords." },
  formatting: "Standard sections.",
  content: "Bullets start with action verbs.",
  readability: { score: score - 2, notes: "Easy to scan." },
  strengths: ["Clear structure"],
  weaknesses: after ? [] : ["Few measurable results"],
  repetitivePhrases: [],
  improvements: after ? ["Add one more metric"] : ["Quantify two more bullets"],
});

const stubGroups = (label) => ({
  groups: [
    { title: `${label} basics`, items: [{ question: `Stub ${label} question one?`, answer: "Stub answer one." }, { question: `Stub ${label} question two?`, answer: "Stub answer two." }] },
    { title: `${label} applied`, items: [{ question: `Stub ${label} question three?`, answer: "Stub answer three." }] },
  ],
});

/**
 * Deterministic JSON for each resume task (the marker line in the system prompt picks it).
 * Every object validates against the API's schemas in services/resume/ai/schemas.ts.
 */
export function resumeAnswer(task, body) {
  switch (task) {
    case "parse":
      return { document: STUB_DOC };
    case "rewrite":
      return { document: STUB_DOC, coverLetter: { greeting: "Dear Hiring Manager,", paragraphs: ["I am excited to apply.", "My recent work is described in my resume.", "Thank you for your time."], closing: "Sincerely," } };
    case "analysis":
      return stubReport(58, false);
    case "analysis_after":
      return stubReport(82, true);
    case "interview_non_technical":
      return stubGroups("Behavioural");
    case "interview_dsa":
      return stubGroups("DSA");
    case "interview_programming":
      return stubGroups("Programming");
    case "interview_system_design":
      return stubGroups("System design");
    case "roadmap":
      return { targetRole: "Senior Software Engineer", summary: "A stub plan.", phases: [{ title: "Close gaps", timeframe: "Weeks 1 to 4", goals: ["Learn one tool"], skills: ["Docker"], resources: ["Official documentation"] }], certifications: [] };
    case "projects":
      return { projects: [{ title: "Stub Project", description: "A stub project.", difficulty: "beginner", tech: ["TypeScript"], outcomes: ["Runs locally"], resumeBullet: "Built a stub project [add result]." }] };
    case "chat": {
      const last = lastUserText(body.messages);
      const named = /my name is ([A-Za-z ]{2,40})/i.exec(last)?.[1]?.trim();
      return { assistant_message: "Got it. What is your most recent job?", document: { ...STUB_DOC, personal: { ...STUB_DOC.personal, ...(named ? { fullName: named } : {}) } }, next_prompts: ["Add work experience", "Add education"] };
    }
    default:
      return null;
  }
}

/** Decide the answer for a request. Resume tasks add their deterministic outputs here. */
function answerFor(body) {
  const text = lastUserText(body.messages);
  const echo = text.replace(/\s+/g, " ").trim().slice(0, 80);
  const lower = text.toLowerCase();
  if (lower.includes("context overflow")) return { error: { status: 400, code: "context_length_exceeded", message: "This model's maximum context length was exceeded." } };
  if (lower.includes("ratelimit")) return { error: { status: 429, code: "rate_limit_exceeded", message: "Rate limit reached." } };
  if (/\bfail\b/.test(lower)) return { error: { status: 500, code: "server_error", message: "The stub was asked to fail." } };
  const wantsJson = body.response_format?.type === "json_object";
  const task = taskOf(body);
  const resume = task ? resumeAnswer(task, body) : null;
  if (resume) return { text: JSON.stringify(resume), delay: 5, slow: false, wantsJson };
  const answer = wantsJson ? JSON.stringify({ stub: true, echo }) : `Stub reply: ${echo}`;
  return { text: answer, delay: /\bslow\b/.test(lower) ? 60 : 5, slow: /\bslow\b/.test(lower), wantsJson };
}

/** Split into word pieces so a stream arrives in several chunks. */
function piecesOf(text) {
  return text.match(/\S+\s*/g) ?? [text];
}

async function chatCompletions(res, body) {
  const d = answerFor(body);
  if (d.error) return send(res, d.error.status, { error: { message: d.error.message, type: d.error.code, code: d.error.code } });
  const id = "chatcmpl-stub";
  const text = d.slow ? Array.from({ length: 40 }, (_, i) => `Sentence ${i + 1} of a deliberately slow stub answer.`).join(" ") : d.text;
  const usage = { prompt_tokens: Math.ceil(JSON.stringify(body.messages ?? []).length / 4), completion_tokens: Math.ceil(text.length / 4) + 1 };
  if (!body.stream) return send(res, 200, { id, object: "chat.completion", model: body.model, choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }], usage });
  const s = sse(res);
  const pieces = d.slow ? piecesOf(text).reduce((acc, w, i) => (i % 8 === 0 ? [...acc, w] : [...acc.slice(0, -1), acc.at(-1) + w]), []) : piecesOf(text);
  for (const piece of pieces) {
    s.data({ id, object: "chat.completion.chunk", model: body.model, choices: [{ index: 0, delta: { content: piece } }] });
    await sleep(d.delay);
  }
  s.data({ id, object: "chat.completion.chunk", model: body.model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
  if (body.stream_options?.include_usage) s.data({ id, choices: [], usage });
  s.data("[DONE]");
  s.end();
}

// ─── The server ────────────────────────────────────────────────────────────────

export function createStubs(options = {}) {
  const port = options.port ?? Number(process.env.PORT ?? 5199);
  const config = { publicUrl: options.publicUrl ?? process.env.STUB_PUBLIC_URL ?? `http://localhost:${port}` };
  const state = { requests: [] };

  async function handler(req, res) {
    const url = new URL(req.url ?? "/", "http://stub");
    const p = url.pathname;
    try {
      const raw = req.method === "POST" ? await readBody(req) : Buffer.alloc(0);
      let body = null;
      if (raw.length) {
        try {
          body = JSON.parse(raw.toString("utf8"));
        } catch {
          body = null;
        }
      }
      if (!p.startsWith("/__/") && p !== "/up") {
        state.requests.unshift({ method: req.method, path: p, at: new Date().toISOString(), body, headers: { authorization: req.headers.authorization ? "present" : "absent" } });
        if (state.requests.length > 500) state.requests.pop();
      }
      if (p === "/up") return send(res, 200, { ok: true });
      if (p === "/__/requests") return send(res, 200, state.requests);
      if (p === "/__/reset" && req.method === "POST") return (state.requests.length = 0), send(res, 200, { ok: true });
      if (p === "/v1/models" && req.method === "GET") return send(res, 200, { object: "list", data: [{ id: "stub-text", object: "model", owned_by: "stub" }] });
      if (p === "/v1/chat/completions" && req.method === "POST") {
        if (!body || !Array.isArray(body.messages)) return send(res, 400, { error: { message: "messages is required", type: "invalid_request_error" } });
        return await chatCompletions(res, body);
      }
      return send(res, 404, { error: { message: `no stub for ${req.method} ${p}` } });
    } catch (err) {
      if (!res.headersSent) send(res, 500, { error: { message: err instanceof Error ? err.message : "stub error" } });
      else res.end();
    }
  }

  return { handler, config, state };
}

/** Tests: listen on an ephemeral port. Returns the base URL and a close function. */
export async function startStubs(options = {}) {
  const stubs = createStubs({ ...options, port: options.port ?? 0 });
  const server = http.createServer((req, res) => void stubs.handler(req, res));
  await new Promise((resolve) => server.listen(options.port ?? 0, options.host ?? "127.0.0.1", resolve));
  const address = server.address();
  const url = `http://${options.host ?? "127.0.0.1"}:${address.port}`;
  if (!options.publicUrl) stubs.config.publicUrl = url;
  return { ...stubs, url, close: () => new Promise((resolve) => (server.closeAllConnections?.(), server.close(() => resolve()))) };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const stubs = createStubs();
  const port = Number(process.env.PORT ?? 5199);
  http.createServer((req, res) => void stubs.handler(req, res)).listen(port, "0.0.0.0", () => process.stdout.write(`stubs listening on ${port}\n`));
}
