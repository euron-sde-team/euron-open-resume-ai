import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { QuotaNotice } from "@/components/resume/quota-notice";
import { formatResetDate, isQuotaError, quotaView, runsLeftText } from "@/lib/resume/quota";

describe("quotaView", () => {
  it("reads the contract shape", () => {
    const q = quotaView({ runs: { used: 7, limit: 10, resetsAt: "2026-12-01T00:00:00.000Z" }, resumes: { count: 2, limit: 5 }, maxUploadMb: 4, tier: { id: "t", name: "Free" } });
    expect(q).toMatchObject({ used: 7, limit: 10, left: 3, exhausted: false, resumesCount: 2, resumesLimit: 5, maxUploadMb: 4, tierName: "Free", resetsAt: "2026-12-01T00:00:00.000Z" });
  });

  it("reads the shell shape", () => {
    const q = quotaView({ month: "2026-11", runs: { used: 10, limit: 10 }, byKind: {}, limits: { monthlyRuns: 10, maxResumes: 8, maxUploadMb: 6 }, resetsAt: "2026-12-01T00:00:00.000Z" });
    expect(q).toMatchObject({ exhausted: true, left: 0, resumesLimit: 8, maxUploadMb: 6, resetsAt: "2026-12-01T00:00:00.000Z" });
  });

  it("treats a null limit as unlimited and survives garbage", () => {
    expect(quotaView({ runs: { used: 99, limit: null } })).toMatchObject({ limit: null, left: null, exhausted: false });
    expect(quotaView(undefined)).toMatchObject({ used: 0, limit: null, exhausted: false });
    expect(quotaView("nope")).toMatchObject({ limit: null });
  });

  it("words the remaining runs and the reset date", () => {
    expect(runsLeftText(quotaView({ runs: { used: 9, limit: 10 } }))).toBe("1 run left this month");
    expect(runsLeftText(quotaView({ runs: { used: 5, limit: 10 } }))).toBe("5 runs left this month");
    expect(runsLeftText(quotaView({ runs: { used: 5, limit: null } }))).toBeNull();
    expect(formatResetDate("2026-12-01T00:00:00.000Z", "en-US")).toBe("December 1");
    expect(formatResetDate(null)).toBe("the start of next month");
  });

  it("recognises the quota refusal", () => {
    expect(isQuotaError({ code: "QUOTA_EXHAUSTED" })).toBe(true);
    expect(isQuotaError({ code: "RATE_LIMITED" })).toBe(false);
    expect(isQuotaError(null)).toBe(false);
  });
});

describe("QuotaNotice", () => {
  it("says how many runs are left, politely", () => {
    render(<QuotaNotice quota={quotaView({ runs: { used: 3, limit: 10 } })} cost />);
    const el = screen.getByRole("status");
    expect(el).toHaveTextContent("7 runs left this month. This uses one.");
  });

  it("states when the runs come back once they are used up", () => {
    render(<QuotaNotice quota={quotaView({ runs: { used: 10, limit: 10, resetsAt: "2026-12-01T00:00:00.000Z" } })} />);
    expect(screen.getByTestId("quota-exhausted")).toHaveTextContent(/Monthly runs used up\. They reset on .*1/);
    expect(screen.getByTestId("quota-exhausted")).toHaveTextContent("still read, edit and download");
  });

  it("renders nothing for an unlimited allowance", () => {
    const { container } = render(<QuotaNotice quota={quotaView({ runs: { used: 3, limit: null } })} />);
    expect(container).toBeEmptyDOMElement();
  });
});
