import { describe, expect, test } from "vitest";
import type { ComponentKind, ComponentStatus } from "@open-resume/types";
import { COMPONENTS, componentStates, deriveStatus, jobFor, MAX_ATTEMPTS } from "../../src/services/resume/components";

const row = (kind: ComponentKind, status: ComponentStatus, claimed = false) => ({ kind, status, claimed });

describe("deriveStatus", () => {
  test("no rows or nothing started: queued", () => {
    expect(deriveStatus([])).toBe("queued");
    expect(deriveStatus([row("analysis", "processing"), row("rewrite", "processing")])).toBe("queued");
  });
  test("a claimed core row: processing", () => {
    expect(deriveStatus([row("analysis", "processing", true), row("rewrite", "processing", true)])).toBe("processing");
  });
  test("both done: analyzed, even while extras run or fail", () => {
    const core = [row("analysis", "done"), row("rewrite", "done")];
    expect(deriveStatus(core)).toBe("analyzed");
    expect(deriveStatus([...core, row("roadmap", "processing", true), row("projects", "failed")])).toBe("analyzed");
  });
  test("any failed core row: error", () => {
    expect(deriveStatus([row("analysis", "failed"), row("rewrite", "failed")])).toBe("error");
    expect(deriveStatus([row("analysis", "done"), row("rewrite", "failed")])).toBe("error");
  });
});

describe("registry", () => {
  test("analysis covers analysis and rewrite; every kind maps to a job", () => {
    expect(COMPONENTS.analysis.covers).toEqual(["analysis", "rewrite"]);
    expect(jobFor("rewrite")).toBe("analysis");
    expect(jobFor("roadmap")).toBe("roadmap");
    for (const def of Object.values(COMPONENTS)) expect(def.cost).toBe(1);
    expect(MAX_ATTEMPTS).toBe(3);
  });
  test("componentStates fills every kind, missing ones as pending", () => {
    const at = new Date("2026-01-01T00:00:00Z");
    const states = componentStates([{ kind: "analysis", status: "failed", error: "bad", updated_at: at }], at);
    expect(Object.keys(states)).toHaveLength(8);
    expect(states.analysis).toEqual({ status: "failed", error: "bad", updatedAt: at.toISOString() });
    expect(states.roadmap.status).toBe("pending");
  });
});
