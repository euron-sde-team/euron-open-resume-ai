"use client";

import Link from "next/link";
import { cn } from "@open-resume/ui";
import { useProductName } from "@/lib/meta";

/** Split for the two-tone wordmark: all but the last word strong, the last word muted. */
export function splitName(name: string): { lead: string; tail: string } {
  const t = name.trim();
  const i = t.lastIndexOf(" ");
  return i < 0 ? { lead: t, tail: "" } : { lead: t.slice(0, i), tail: t.slice(i + 1) };
}

export function LogoMark({ className }: { className?: string }) {
  // A page with a folded corner and a spark: a resume that sharpens.
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn("size-8 shrink-0", className)}>
      <rect width="32" height="32" rx="9" className="fill-ink" />
      <path d="M10.5 6.5h8.2l5 5v13a1.5 1.5 0 0 1-1.5 1.5h-11.7a1.5 1.5 0 0 1-1.5-1.5v-16.5a1.5 1.5 0 0 1 1.5-1.5z" fill="white" fillOpacity="0.94" />
      <path d="M18.7 6.5v3.5a1.5 1.5 0 0 0 1.5 1.5h3.5" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1" />
      <path d="M16 15l1.1 2.4 2.4 1.1-2.4 1.1L16 22l-1.1-2.4-2.4-1.1 2.4-1.1z" className="fill-brand" />
    </svg>
  );
}

export function Wordmark({ compact, className, textClassName }: { compact?: boolean; className?: string; textClassName?: string }) {
  const name = useProductName();
  const { lead, tail } = splitName(name);
  return (
    <Link href="/" className={cn("flex min-w-0 items-center gap-2 rounded-md focus-visible:ring-2", className)} aria-label={`${name} home`}>
      <LogoMark />
      {compact ? null : (
        <span className={cn("truncate font-display text-[17px] font-semibold tracking-[-0.02em] text-foreground", textClassName)}>
          {lead}
          {tail ? <span className="font-semibold text-muted-foreground"> {tail}</span> : null}
        </span>
      )}
    </Link>
  );
}
