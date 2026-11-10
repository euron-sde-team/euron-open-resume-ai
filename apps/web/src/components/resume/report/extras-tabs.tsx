"use client";

import { useState } from "react";
import { INTERVIEW_TRACKS, type CareerRoadmap, type InterviewGroup, type InterviewTrack, type ProjectIdea, type ResumeDetail } from "@open-resume/types";
import { UnderlineTabs } from "@/components/common/underline-tabs";
import { SimpleText } from "../simple-text";
import { Inline, Prose, Rows, Section } from "./bits";
import { OnDemand, type Actions } from "./on-demand";

const TRACK_LABEL: Record<InterviewTrack, string> = {
  non_technical: "Non-technical",
  dsa: "DSA",
  programming: "Programming",
  system_design: "System design",
};

function Groups({ groups }: { groups: InterviewGroup[] }) {
  return (
    <div>
      {groups.map((g, gi) => (
        <section key={gi} className="mb-8">
          <h3 className="mb-2 font-display text-[16px] font-semibold">{g.title}</h3>
          <ul className="border-t border-border">
            {g.items.map((qa, i) => (
              <li key={i} className="border-b border-border">
                <details className="group py-3" data-testid="interview-item">
                  <summary className="flex cursor-pointer list-none items-start gap-3 text-[14.5px] font-medium focus-visible:rounded-sm [&::-webkit-details-marker]:hidden">
                    <span className="w-5 shrink-0 text-right tabular-nums text-subtle-foreground">{i + 1}</span>
                    <span className="min-w-0 flex-1">{qa.question}</span>
                    <span aria-hidden className="shrink-0 text-[12.5px] font-normal text-muted-foreground group-open:hidden">
                      Show answer
                    </span>
                  </summary>
                  <SimpleText className="mt-2 pl-8 text-[14.5px] leading-relaxed text-muted-foreground">{qa.answer}</SimpleText>
                </details>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function InterviewTab({ detail, actions }: { detail: ResumeDetail; actions: Actions }) {
  const [track, setTrack] = useState<InterviewTrack>("non_technical");
  const groups = detail.interview?.[track] ?? [];
  const kind = `interview_${track}` as const;
  return (
    <div data-testid="interview-tab">
      <UnderlineTabs
        label="Interview track"
        size="sm"
        idPrefix="track"
        value={track}
        onChange={setTrack}
        tabs={INTERVIEW_TRACKS.map((t) => ({ value: t, label: TRACK_LABEL[t] }))}
        className="mb-6"
      />
      <div id="track-panel" role="tabpanel" aria-labelledby={`track-tab-${track}`}>
        <OnDemand kind={kind} detail={detail} actions={actions} hasData={groups.length > 0} noun={`${TRACK_LABEL[track].toLowerCase()} interview questions`}>
          <Groups groups={groups} />
        </OnDemand>
      </div>
    </div>
  );
}

function Roadmap({ r }: { r: CareerRoadmap }) {
  return (
    <div data-testid="roadmap-view">
      <Prose>
        <span className="font-medium">Target role: </span>
        {r.targetRole}
      </Prose>
      {r.summary ? <p className="mt-2 max-w-[68ch] text-[14.5px] leading-relaxed text-muted-foreground">{r.summary}</p> : null}
      <div className="mt-6">
        {r.phases.map((p, i) => (
          <Section key={i} title={`${i + 1}. ${p.title}`}>
            {p.timeframe ? <p className="-mt-2 mb-3 text-[13px] text-muted-foreground">{p.timeframe}</p> : null}
            <Rows items={p.goals ?? []} />
            <div className="mt-3 space-y-1.5">
              {p.skills?.length ? <Inline label="Skills" values={p.skills} /> : null}
              {p.resources?.length ? <Inline label="Resources" values={p.resources} /> : null}
            </div>
          </Section>
        ))}
      </div>
      {r.certifications?.length ? (
        <Section title="Certifications to consider">
          <Rows items={r.certifications} />
        </Section>
      ) : null}
    </div>
  );
}

export function RoadmapTab({ detail, actions }: { detail: ResumeDetail; actions: Actions }) {
  return (
    <div data-testid="roadmap-tab">
      <OnDemand kind="roadmap" detail={detail} actions={actions} hasData={!!detail.roadmap} noun="a career roadmap">
        {detail.roadmap ? <Roadmap r={detail.roadmap} /> : null}
      </OnDemand>
    </div>
  );
}

const LEVEL: Record<ProjectIdea["difficulty"], string> = { beginner: "Beginner", intermediate: "Intermediate", advanced: "Advanced" };

export function ProjectsTab({ detail, actions }: { detail: ResumeDetail; actions: Actions }) {
  const projects = detail.projects ?? [];
  return (
    <div data-testid="projects-tab">
      <OnDemand kind="projects" detail={detail} actions={actions} hasData={projects.length > 0} noun="project ideas">
        <ul className="border-t border-border">
          {projects.map((p, i) => (
            <li key={i} className="border-b border-border py-6" data-testid="project-idea">
              <h3 className="font-display text-[17px] font-semibold">{p.title}</h3>
              <p className="mt-0.5 text-[13px] text-muted-foreground">{[LEVEL[p.difficulty], p.tech?.join(", ")].filter(Boolean).join(" · ")}</p>
              <p className="mt-2 max-w-[68ch] text-[14.5px] leading-relaxed">{p.description}</p>
              {p.outcomes?.length ? (
                <div className="mt-3">
                  <Rows items={p.outcomes} />
                </div>
              ) : null}
              {p.resumeBullet ? (
                <p className="mt-3 max-w-[68ch] text-[14px] text-muted-foreground">
                  <span className="font-medium text-foreground">For your resume: </span>
                  {p.resumeBullet}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      </OnDemand>
    </div>
  );
}
