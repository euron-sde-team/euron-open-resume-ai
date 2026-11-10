"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { TEMPLATE_IDS, type TemplateId, type TemplateInfo } from "@open-resume/types";
import { Button, cn, Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@open-resume/ui";
import { useTemplates } from "@/lib/resume/queries";

function titleCase(id: string): string {
  return id
    .replace(/_?(resume_)?template$/, "")
    .split("_")
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ") || "Classic";
}

/** The list to show: the API's, else the 13 known ids so the picker never comes up empty. */
export function templateList(fromApi: TemplateInfo[] | undefined): TemplateInfo[] {
  if (fromApi && fromApi.length) return fromApi;
  return TEMPLATE_IDS.map((id) => ({ id, name: titleCase(id), description: "", columns: 1 as const, accent: "#64748b", atsFriendly: true }));
}

/** A thumbnail from /templates/<id>.png; a quiet tile with the initial when it is missing. */
function Thumb({ info }: { info: TemplateInfo }) {
  const [missing, setMissing] = useState(false);
  return (
    <span className="relative block aspect-[8.5/11] w-full overflow-hidden rounded-md bg-muted ring-1 ring-border">
      {missing ? (
        <span aria-hidden className="flex h-full items-center justify-center font-display text-3xl font-semibold text-subtle-foreground">
          {info.name.slice(0, 1)}
        </span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/templates/${info.id}.png`} alt="" loading="lazy" onError={() => setMissing(true)} className="h-full w-full object-cover object-top" />
      )}
    </span>
  );
}

export function TemplatePicker({ value, onChange }: { value: TemplateId; onChange: (id: TemplateId) => void }) {
  const { data } = useTemplates();
  const list = templateList(data);
  return (
    <div role="radiogroup" aria-label="Template" className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4">
      {list.map((t) => {
        const on = t.id === value;
        return (
          <button key={t.id} type="button" role="radio" aria-checked={on} data-testid={`template-${t.id}`} onClick={() => onChange(t.id)} className="group rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
            <span className={cn("block rounded-md p-0.5", on ? "bg-ink" : "bg-transparent group-hover:bg-border")}>
              <Thumb info={t} />
            </span>
            <span className="mt-2 flex items-center gap-1.5 text-[14px] font-medium">
              {t.name}
              {on ? <Check className="size-3.5 text-primary" aria-label="Selected" /> : null}
            </span>
            <span className="block text-[12.5px] text-muted-foreground">
              {[t.columns === 2 ? "Two columns" : "One column", t.atsFriendly ? "ATS friendly" : null].filter(Boolean).join(" · ")}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** "Template: Modern · Change" opening the picker in a dialog. */
export function TemplateChooser({ value, onChange, className }: { value: TemplateId; onChange: (id: TemplateId) => void; className?: string }) {
  const { data } = useTemplates();
  const [open, setOpen] = useState(false);
  const current = templateList(data).find((t) => t.id === value);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className={className} data-testid="template-open">
          Template: {current?.name ?? titleCase(value)}
        </Button>
      </DialogTrigger>
      <DialogContent size="xl" data-testid="template-dialog">
        <DialogHeader>
          <DialogTitle>Choose a template</DialogTitle>
          <DialogDescription>The preview and your downloads use it. Your content stays the same.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <TemplatePicker
            value={value}
            onChange={(id) => {
              onChange(id);
              setOpen(false);
            }}
          />
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
