import { describe, expect, test } from "vitest";
import { resumeAnswer } from "../../../../stubs/server.mjs";
import { analysisReportSchema, chatSchema, interviewSchema, parseSchema, projectsSchema, rewriteSchema, roadmapSchema } from "../../../src/services/resume/ai/schemas";

const body = { messages: [{ role: "user", content: "hi" }] };

describe("the stub's canned answers satisfy the API schemas", () => {
  test.each([
    ["parse", parseSchema],
    ["rewrite", rewriteSchema],
    ["analysis", analysisReportSchema],
    ["analysis_after", analysisReportSchema],
    ["interview_non_technical", interviewSchema],
    ["interview_dsa", interviewSchema],
    ["interview_programming", interviewSchema],
    ["interview_system_design", interviewSchema],
    ["roadmap", roadmapSchema],
    ["projects", projectsSchema],
    ["chat", chatSchema],
  ] as const)("%s", (task, schema) => {
    const r = schema.safeParse(resumeAnswer(task, body));
    expect(r.success, JSON.stringify(r.success ? "" : r.error.issues)).toBe(true);
  });
});
