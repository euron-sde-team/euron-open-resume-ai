import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentKind, ComponentState, ResumeStatusView } from "@open-resume/types";
import { componentSignature, isWorking, nextPollDelay, useResumeStatus } from "@/lib/resume/polling";

const status = vi.fn();
vi.mock("@/lib/api", () => ({ api: () => ({ resumes: { status } }) }));

const KINDS: ComponentKind[] = ["analysis", "rewrite", "interview_non_technical", "interview_dsa", "interview_programming", "interview_system_design", "roadmap", "projects"];
function view(s: ResumeStatusView["status"], over: Partial<Record<ComponentKind, ComponentState["status"]>> = {}): ResumeStatusView {
  const components = Object.fromEntries(KINDS.map((k) => [k, { status: over[k] ?? "pending", updatedAt: "2026-11-10T00:00:00Z" }])) as ResumeStatusView["components"];
  return { status: s, components, updatedAt: "2026-11-10T00:00:00Z" };
}

describe("polling helpers", () => {
  it("backs off from 1.5 s to a 10 s ceiling", () => {
    expect([0, 1, 2, 3].map(nextPollDelay)).toEqual([1500, 2250, 3375, 5063]);
    expect(nextPollDelay(10)).toBe(10_000);
    expect(nextPollDelay(-3)).toBe(1500);
  });

  it("is working until analysed or errored and no component runs", () => {
    expect(isWorking(undefined)).toBe(true);
    expect(isWorking(view("queued"))).toBe(true);
    expect(isWorking(view("processing"))).toBe(true);
    expect(isWorking(view("analyzed"))).toBe(false);
    expect(isWorking(view("error"))).toBe(false);
    expect(isWorking(view("analyzed", { roadmap: "processing" }))).toBe(true);
    expect(isWorking(view("analyzed", { roadmap: "failed", projects: "done" }))).toBe(false);
  });

  it("changes signature when a component changes", () => {
    expect(componentSignature(view("analyzed"))).not.toBe(componentSignature(view("analyzed", { analysis: "done" })));
    expect(componentSignature(undefined)).toBe("");
  });
});

describe("useResumeStatus", () => {
  const wrapper = (qc: QueryClient) => {
    const Wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    return Wrapper;
  };
  beforeEach(() => status.mockReset());

  it("keeps polling while the resume is processing, stops when analysed and refetches the report", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    status.mockResolvedValueOnce(view("queued")).mockResolvedValueOnce(view("processing", { analysis: "processing" })).mockResolvedValue(view("analyzed", { analysis: "done", rewrite: "done" }));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useResumeStatus("R1"), { wrapper: wrapper(qc) });

    await waitFor(() => expect(result.current.data?.status).toBe("queued"));
    expect(result.current.working).toBe(true);
    // Backoff: each poll waits longer than the one before (1.5 s, 2.3 s, 3.4 s ...).
    for (let i = 0; i < 8 && status.mock.calls.length < 3; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
    }
    await waitFor(() => expect(result.current.data?.status).toBe("analyzed"));
    expect(status.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(result.current.working).toBe(false);
    const calls = status.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(status.mock.calls.length).toBe(calls);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["resumes", "detail", "R1"] });
    vi.useRealTimers();
  });

  it("does not poll again after an error status", async () => {
    status.mockResolvedValue(view("error", { analysis: "failed" }));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useResumeStatus("R2"), { wrapper: wrapper(qc) });
    await waitFor(() => expect(result.current.data?.status).toBe("error"));
    expect(result.current.working).toBe(false);
    expect(status).toHaveBeenCalledTimes(1);
  });

  it("kick marks a component as running so polling resumes", async () => {
    status.mockResolvedValue(view("analyzed", { analysis: "done" }));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useResumeStatus("R3"), { wrapper: wrapper(qc) });
    await waitFor(() => expect(result.current.data?.status).toBe("analyzed"));
    status.mockResolvedValue(view("analyzed", { analysis: "done", roadmap: "processing" }));
    act(() => result.current.kick("roadmap"));
    expect(qc.getQueryData<ResumeStatusView>(["resumes", "status", "R3"])?.components.roadmap.status).toBe("processing");
    await waitFor(() => expect(result.current.working).toBe(true));
  });
});
