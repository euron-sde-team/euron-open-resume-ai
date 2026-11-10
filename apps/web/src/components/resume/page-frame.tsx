"use client";

import { Menu } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@open-resume/ui";
import { useShell } from "@/components/app/shell-context";

/** The top bar every screen shares: the sidebar opener when the sidebar is hidden. */
export function TopBar({ children, className }: { children?: ReactNode; className?: string }) {
  const shell = useShell();
  return (
    <header className={cn("flex h-14 shrink-0 items-center gap-1 px-2 sm:px-3", className)}>
      {shell.collapsed || shell.mobile ? (
        <button type="button" aria-label="Open sidebar" onClick={shell.open} className="inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted">
          <Menu className="size-5" />
        </button>
      ) : null}
      {children}
    </header>
  );
}

/** A scrolling page with the main column (780px by default, per DESIGN.md). */
export function PageFrame({ children, width = "max-w-[780px]", className }: { children: ReactNode; width?: string; className?: string }) {
  return (
    <div className="h-full overflow-y-auto">
      <TopBar />
      <div className={cn("mx-auto w-full px-4 pb-24 sm:px-6", width, className)}>{children}</div>
    </div>
  );
}

export function PageHeading({ title, meta, actions, testId }: { title: ReactNode; meta?: ReactNode; actions?: ReactNode; testId?: string }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <h1 data-testid={testId} className="font-display text-[28px] font-semibold leading-tight tracking-[-0.02em] sm:text-[30px]">
          {title}
        </h1>
        {meta ? <div className="mt-1 text-[13px] text-muted-foreground">{meta}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
