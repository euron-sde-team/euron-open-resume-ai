"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Plus } from "lucide-react";
import type { ResumeDocument } from "@open-resume/types";
import { Button, Input, Label, Textarea } from "@open-resume/ui";
import { parseCsv, parseLines, patchAt, removeAt, sameList } from "@/lib/resume/document";

type Doc = ResumeDocument;

function TextField({ label, value, onChange, multiline, rows = 3, max = 400, placeholder }: { label: string; value: string | undefined; onChange: (v: string) => void; multiline?: boolean; rows?: number; max?: number; placeholder?: string }) {
  const id = useId();
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-[13px] text-muted-foreground">
        {label}
      </Label>
      {multiline ? (
        <Textarea id={id} rows={rows} value={value ?? ""} maxLength={max} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <Input id={id} value={value ?? ""} maxLength={max} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}

/** A list edited as text (one per line, or comma separated) that parses as you type without eating separators. */
function ListField({ label, value, onChange, mode, rows = 4, placeholder }: { label: string; value: string[] | undefined; onChange: (v: string[]) => void; mode: "lines" | "csv"; rows?: number; placeholder?: string }) {
  const id = useId();
  const parse = mode === "lines" ? parseLines : parseCsv;
  const join = (v: string[]) => v.join(mode === "lines" ? "\n" : ", ");
  const list = value ?? [];
  const [text, setText] = useState(join(list));
  const last = useRef(list);
  useEffect(() => {
    // Another source changed the list (an assistant turn, an import): show it.
    if (last.current !== list && !sameList(list, parse(text))) setText(join(list));
    last.current = list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-[13px] text-muted-foreground">
        {label}
      </Label>
      {mode === "lines" ? (
        <Textarea
          id={id}
          rows={rows}
          value={text}
          placeholder={placeholder}
          onChange={(e) => {
            setText(e.target.value);
            onChange(parse(e.target.value));
          }}
        />
      ) : (
        <Input
          id={id}
          value={text}
          placeholder={placeholder}
          onChange={(e) => {
            setText(e.target.value);
            onChange(parse(e.target.value));
          }}
        />
      )}
    </div>
  );
}

function Block({ title, children, onAdd, addLabel }: { title: string; children: React.ReactNode; onAdd?: () => void; addLabel?: string }) {
  return (
    <section className="border-t border-border py-6 first:border-t-0 first:pt-0">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-display text-[17px] font-semibold">{title}</h3>
        {onAdd ? (
          <Button variant="ghost" size="sm" onClick={onAdd}>
            <Plus /> {addLabel ?? "Add"}
          </Button>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function Entry({ label, onRemove, children }: { label: string; onRemove: () => void; children: React.ReactNode }) {
  return (
    <fieldset className="mb-6 space-y-3 border-b border-border pb-6 last:mb-0 last:border-b-0 last:pb-0">
      <legend className="sr-only">{label}</legend>
      {children}
      <button type="button" onClick={onRemove} aria-label={`Remove ${label}`} className="text-[13px] text-muted-foreground underline-offset-4 hover:text-danger hover:underline">
        Remove
      </button>
    </fieldset>
  );
}

const two = "grid gap-3 sm:grid-cols-2";

/** A compact structured editor for the whole document, next to the preview, so anything can be fixed by hand. */
export function SectionEditor({ doc, onChange }: { doc: Doc; onChange: (d: Doc) => void }) {
  const set = (patch: Partial<Doc>) => onChange({ ...doc, ...patch });
  const p = doc.personal ?? {};
  const l = doc.links ?? {};
  return (
    <div data-testid="section-editor" className="pb-16">
      <Block title="Personal">
        <div className={two}>
          <TextField label="Full name" value={p.fullName} onChange={(v) => set({ personal: { ...p, fullName: v } })} />
          <TextField label="Headline" value={p.headline} onChange={(v) => set({ personal: { ...p, headline: v } })} />
          <TextField label="Email" value={p.email} onChange={(v) => set({ personal: { ...p, email: v } })} />
          <TextField label="Phone" value={p.phone} onChange={(v) => set({ personal: { ...p, phone: v } })} />
          <TextField label="Location" value={p.location} onChange={(v) => set({ personal: { ...p, location: v } })} />
          <TextField label="LinkedIn" value={l.linkedin} onChange={(v) => set({ links: { ...l, linkedin: v } })} />
          <TextField label="GitHub" value={l.github} onChange={(v) => set({ links: { ...l, github: v } })} />
          <TextField label="Portfolio" value={l.portfolio} onChange={(v) => set({ links: { ...l, portfolio: v } })} />
        </div>
      </Block>

      <Block title="Summary">
        <TextField label="Summary" value={doc.summary} multiline rows={4} max={2000} onChange={(v) => set({ summary: v })} />
      </Block>

      <Block title="Experience" addLabel="Add job" onAdd={() => set({ experience: [...(doc.experience ?? []), { title: "", company: "", bullets: [] }] })}>
        {(doc.experience ?? []).map((x, i) => (
          <Entry key={i} label={`experience ${i + 1}`} onRemove={() => set({ experience: removeAt(doc.experience, i) })}>
            <div className={two}>
              <TextField label="Title" value={x.title} onChange={(v) => set({ experience: patchAt(doc.experience, i, { title: v }) })} />
              <TextField label="Company" value={x.company} onChange={(v) => set({ experience: patchAt(doc.experience, i, { company: v }) })} />
              <TextField label="Start" value={x.start} onChange={(v) => set({ experience: patchAt(doc.experience, i, { start: v }) })} />
              <TextField label="End" value={x.end} onChange={(v) => set({ experience: patchAt(doc.experience, i, { end: v }) })} />
            </div>
            <ListField label="Bullets, one per line" mode="lines" value={x.bullets} onChange={(v) => set({ experience: patchAt(doc.experience, i, { bullets: v }) })} />
          </Entry>
        ))}
      </Block>

      <Block title="Education" addLabel="Add school" onAdd={() => set({ education: [...(doc.education ?? []), { degree: "", institution: "" }] })}>
        {(doc.education ?? []).map((x, i) => (
          <Entry key={i} label={`education ${i + 1}`} onRemove={() => set({ education: removeAt(doc.education, i) })}>
            <div className={two}>
              <TextField label="Degree" value={x.degree} onChange={(v) => set({ education: patchAt(doc.education, i, { degree: v }) })} />
              <TextField label="Institution" value={x.institution} onChange={(v) => set({ education: patchAt(doc.education, i, { institution: v }) })} />
              <TextField label="Start" value={x.start} onChange={(v) => set({ education: patchAt(doc.education, i, { start: v }) })} />
              <TextField label="End" value={x.end} onChange={(v) => set({ education: patchAt(doc.education, i, { end: v }) })} />
            </div>
            <TextField label="Details" value={x.details} onChange={(v) => set({ education: patchAt(doc.education, i, { details: v }) })} />
          </Entry>
        ))}
      </Block>

      <Block title="Skills" addLabel="Add group" onAdd={() => set({ skills: [...(doc.skills ?? []), { category: "", items: [] }] })}>
        {(doc.skills ?? []).map((x, i) => (
          <Entry key={i} label={`skill group ${i + 1}`} onRemove={() => set({ skills: removeAt(doc.skills, i) })}>
            <TextField label="Group" value={x.category} onChange={(v) => set({ skills: patchAt(doc.skills, i, { category: v }) })} />
            <ListField label="Skills, separated by commas" mode="csv" value={x.items} onChange={(v) => set({ skills: patchAt(doc.skills, i, { items: v }) })} />
          </Entry>
        ))}
      </Block>

      <Block title="Projects" addLabel="Add project" onAdd={() => set({ projects: [...(doc.projects ?? []), { name: "", description: "", tech: [], bullets: [] }] })}>
        {(doc.projects ?? []).map((x, i) => (
          <Entry key={i} label={`project ${i + 1}`} onRemove={() => set({ projects: removeAt(doc.projects, i) })}>
            <div className={two}>
              <TextField label="Name" value={x.name} onChange={(v) => set({ projects: patchAt(doc.projects, i, { name: v }) })} />
              <TextField label="Link" value={x.link} onChange={(v) => set({ projects: patchAt(doc.projects, i, { link: v }) })} />
            </div>
            <TextField label="Description" value={x.description} multiline rows={2} onChange={(v) => set({ projects: patchAt(doc.projects, i, { description: v }) })} />
            <ListField label="Technologies, separated by commas" mode="csv" value={x.tech} onChange={(v) => set({ projects: patchAt(doc.projects, i, { tech: v }) })} />
            <ListField label="Bullets, one per line" mode="lines" rows={3} value={x.bullets} onChange={(v) => set({ projects: patchAt(doc.projects, i, { bullets: v }) })} />
          </Entry>
        ))}
      </Block>
    </div>
  );
}
