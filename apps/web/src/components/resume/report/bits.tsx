"use client";

import type { ReactNode } from "react";
import { cn } from "@open-resume/ui";

/** A titled block on the page ground, separated from the one above by a hairline. */
export function Section({ title, children, className, id }: { title: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={cn("border-t border-border py-6 first:border-t-0 first:pt-0", className)}>
      <h2 className="mb-3 font-display text-[18px] font-semibold tracking-[-0.01em]">{title}</h2>
      {children}
    </section>
  );
}

/** Items as hairline rows. */
export function Rows({ items, ordered, empty }: { items: string[]; ordered?: boolean; empty?: string }) {
  if (!items.length) return empty ? <p className="text-[14px] text-muted-foreground">{empty}</p> : null;
  const Tag = ordered ? "ol" : "ul";
  return (
    <Tag className="border-t border-border">
      {items.map((t, i) => (
        <li key={i} className="flex gap-3 border-b border-border py-2.5 text-[14.5px] leading-relaxed">
          {ordered ? <span className="w-5 shrink-0 text-right tabular-nums text-subtle-foreground">{i + 1}</span> : null}
          <span className="min-w-0">{t}</span>
        </li>
      ))}
    </Tag>
  );
}

/** "Label: a, b, c" as one line of type. */
export function Inline({ label, values, empty }: { label: string; values: string[]; empty?: string }) {
  return (
    <p className="text-[14.5px] leading-relaxed">
      <span className="font-medium">{label}: </span>
      {values.length ? <span className="text-muted-foreground">{values.join(", ")}</span> : <span className="text-subtle-foreground">{empty ?? "None"}</span>}
    </p>
  );
}

export function Prose({ children }: { children: ReactNode }) {
  return <p className="max-w-[68ch] text-[15px] leading-[1.7]">{children}</p>;
}
