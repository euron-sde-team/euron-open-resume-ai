"use client";

import type { AnalysisReport, ResumeDetail } from "@open-resume/types";
import { Inline, Prose, Rows, Section } from "./bits";

function Score({ label, report }: { label: string; report: AnalysisReport }) {
  return (
    <div>
      <p className="text-[13px] text-muted-foreground">{label}</p>
      <p className="font-display text-[44px] font-semibold leading-none tracking-[-0.03em] tabular-nums">
        {Math.round(report.score)}
        <span className="ml-1 text-[16px] font-normal text-subtle-foreground">/ 100</span>
      </p>
    </div>
  );
}

export function AnalysisTab({ detail }: { detail: ResumeDetail }) {
  const a = detail.analysis;
  if (!a) return <p className="text-[14px] text-muted-foreground">The analysis is not ready yet.</p>;
  const { before, after } = a;
  const fixes = (after.improvements?.length ? after.improvements : before.improvements) ?? [];
  return (
    <div data-testid="analysis-tab">
      <Section title="Score">
        <div className="flex flex-wrap items-end gap-x-12 gap-y-4">
          <Score label="Original" report={before} />
          <Score label="Improved" report={after} />
        </div>
        <p className="mt-3 text-[13px] text-muted-foreground">
          Readability {Math.round(before.readability.score)} before, {Math.round(after.readability.score)} after.
        </p>
      </Section>
      <Section title="Summary">
        <Prose>{before.summary}</Prose>
        {after.summary ? <p className="mt-3 max-w-[68ch] text-[14.5px] leading-relaxed text-muted-foreground">After the rewrite: {after.summary}</p> : null}
      </Section>
      {fixes.length ? (
        <Section title="Fix these first">
          <Rows items={fixes} ordered />
        </Section>
      ) : null}
      <Section title="Strengths and weaknesses">
        <div className="grid gap-8 md:grid-cols-2">
          <div>
            <h3 className="mb-2 text-[13px] font-medium text-muted-foreground">Strengths</h3>
            <Rows items={before.strengths ?? []} empty="Nothing stood out yet." />
          </div>
          <div>
            <h3 className="mb-2 text-[13px] font-medium text-muted-foreground">Weaknesses</h3>
            <Rows items={before.weaknesses ?? []} empty="No weaknesses found." />
          </div>
        </div>
      </Section>
      <Section title="Keywords">
        <div className="space-y-1.5">
          <Inline label="Matched" values={before.keywords?.matched ?? []} />
          <Inline label={detail.jd ? "Missing from the job description" : "Missing"} values={before.keywords?.missing ?? []} empty={detail.jd ? "None, you cover it" : "Add a job description to check"} />
        </div>
        {before.keywords?.notes ? <p className="mt-3 max-w-[68ch] text-[14px] text-muted-foreground">{before.keywords.notes}</p> : null}
      </Section>
      <Section title="Formatting, content and readability">
        <div className="space-y-4">
          {before.formatting ? <Prose>{before.formatting}</Prose> : null}
          {before.content ? <Prose>{before.content}</Prose> : null}
          {before.readability?.notes ? <Prose>{before.readability.notes}</Prose> : null}
        </div>
        {before.repetitivePhrases?.length ? (
          <div className="mt-4">
            <Inline label="Repeated phrases" values={before.repetitivePhrases} />
          </div>
        ) : null}
      </Section>
    </div>
  );
}
