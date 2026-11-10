/* global fetch */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startStubs } from "../server.mjs";

const TASKS = ["parse", "rewrite", "analysis", "analysis_after", "interview_non_technical", "interview_dsa", "interview_programming", "interview_system_design", "roadmap", "projects", "chat"];

describe("resume task answers", () => {
  let stubs;
  beforeAll(async () => {
    stubs = await startStubs();
  });
  afterAll(() => stubs.close());

  const ask = async (task, user = "<untrusted_resume>\nx\n</untrusted_resume>", stream = false) => {
    const res = await fetch(`${stubs.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "stub-text", response_format: { type: "json_object" }, stream, messages: [{ role: "system", content: `[task:${task}]\nYou are a resume tool.` }, { role: "user", content: user }] }),
    });
    return res;
  };

  it.each(TASKS)("%s returns valid, deterministic JSON", async (task) => {
    const a = (await (await ask(task)).json()).choices[0].message.content;
    const b = (await (await ask(task)).json()).choices[0].message.content;
    expect(JSON.parse(a)).toBeTypeOf("object");
    expect(a).toBe(b);
  });

  it("scores the rewrite higher than the original", async () => {
    const before = JSON.parse((await (await ask("analysis")).json()).choices[0].message.content);
    const after = JSON.parse((await (await ask("analysis_after")).json()).choices[0].message.content);
    expect(after.score).toBeGreaterThan(before.score);
  });

  it("chat picks up a name from the last user message", async () => {
    const out = JSON.parse((await (await ask("chat", "My name is Grace Hopper")).json()).choices[0].message.content);
    expect(out.document.personal.fullName).toBe("Grace Hopper");
    expect(out.assistant_message).toBeTruthy();
  });

  it("falls back to the generic answer without a marker or with an unknown one", async () => {
    const out = JSON.parse((await (await ask("nonsense_task", "hello")).json()).choices[0].message.content);
    expect(out.stub).toBe(true);
  });

  it("streams a task answer that reassembles to the same JSON", async () => {
    const text = await (await ask("roadmap", "x", true)).text();
    const content = text.split("\n\n").filter((b) => b.startsWith("data: {")).map((b) => JSON.parse(b.slice(6)).choices?.[0]?.delta?.content ?? "").join("");
    expect(JSON.parse(content).targetRole).toBeTruthy();
  });
});
