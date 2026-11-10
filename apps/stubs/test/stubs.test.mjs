/* global fetch, TextDecoder */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startStubs } from "../server.mjs";

/** The data payloads of an SSE body, in order. */
function sseData(text) {
  return text
    .split("\n\n")
    .map((block) => block.split("\n").filter((l) => l.startsWith("data: ")).map((l) => l.slice(6)).join("\n"))
    .filter(Boolean);
}

describe("the running stubs", () => {
  let stubs;
  beforeAll(async () => {
    stubs = await startStubs();
  });
  afterAll(() => stubs.close());
  beforeEach(() => fetch(`${stubs.url}/__/reset`, { method: "POST" }));

  const chat = (body, headers = {}) =>
    fetch(`${stubs.url}/v1/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ model: "stub-text", ...body }) });
  const say = (content, extra = {}) => ({ messages: [{ role: "system", content: "You are a stub." }, { role: "user", content }], ...extra });

  it("answers health and lists the one model", async () => {
    expect((await (await fetch(`${stubs.url}/up`)).json()).ok).toBe(true);
    const models = await (await fetch(`${stubs.url}/v1/models`)).json();
    expect(models.data.map((m) => m.id)).toEqual(["stub-text"]);
  });

  it("returns a text answer with usage, the same every time", async () => {
    const a = await (await chat(say("Hello   there"))).json();
    const b = await (await chat(say("Hello there"))).json();
    expect(a.choices[0].message.content).toBe("Stub reply: Hello there");
    expect(b.choices[0].message.content).toBe(a.choices[0].message.content);
    expect(a.usage.prompt_tokens).toBeGreaterThan(0);
    expect(a.usage.completion_tokens).toBeGreaterThan(0);
  });

  it("returns a JSON object in JSON mode", async () => {
    const res = await (await chat(say("Score this resume", { response_format: { type: "json_object" } }))).json();
    expect(JSON.parse(res.choices[0].message.content)).toEqual({ stub: true, echo: "Score this resume" });
  });

  it("reads the last user message when content is an array of parts", async () => {
    const res = await (await chat({ messages: [{ role: "user", content: [{ type: "text", text: "From parts" }] }] })).json();
    expect(res.choices[0].message.content).toBe("Stub reply: From parts");
  });

  it("streams chunks, a finish reason, usage and [DONE]", async () => {
    const res = await chat(say("one two three", { stream: true, stream_options: { include_usage: true } }));
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    const data = sseData(await res.text());
    expect(data.at(-1)).toBe("[DONE]");
    const frames = data.slice(0, -1).map((d) => JSON.parse(d));
    expect(frames.map((f) => f.choices[0]?.delta?.content ?? "").join("")).toBe("Stub reply: one two three");
    expect(frames.some((f) => f.choices[0]?.finish_reason === "stop")).toBe(true);
    expect(frames.at(-1).usage.completion_tokens).toBeGreaterThan(0);
  });

  it("fails on demand: fail 500, ratelimit 429, context overflow 400", async () => {
    expect((await chat(say("please fail"))).status).toBe(500);
    expect((await chat(say("ratelimit me"))).status).toBe(429);
    const overflow = await chat(say("context overflow"));
    expect(overflow.status).toBe(400);
    expect((await overflow.json()).error.code).toBe("context_length_exceeded");
  });

  it("rejects a request without messages", async () => {
    expect((await chat({ messages: undefined })).status).toBe(400);
  });

  it("records requests newest first, noting only whether a key was sent", async () => {
    await chat(say("first"), { Authorization: "Bearer sk-secret" });
    await chat(say("second"));
    const recorded = await (await fetch(`${stubs.url}/__/requests`)).json();
    expect(recorded.map((r) => r.body.messages[1].content)).toEqual(["second", "first"]);
    expect(recorded.map((r) => r.headers.authorization)).toEqual(["absent", "present"]);
    expect(JSON.stringify(recorded)).not.toContain("sk-secret");
    await fetch(`${stubs.url}/__/reset`, { method: "POST" });
    expect(await (await fetch(`${stubs.url}/__/requests`)).json()).toEqual([]);
  });

  it("answers 404 for anything else", async () => {
    expect((await fetch(`${stubs.url}/v1/images/generations`, { method: "POST", body: "{}" })).status).toBe(404);
  });

  it("decodes a stream with TextDecoder end to end", async () => {
    const res = await chat(say("slow", { stream: true }));
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let text = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      if (text.includes("Sentence 2")) {
        await reader.cancel();
        break;
      }
    }
    expect(text).toContain("Sentence 1");
  });
});
