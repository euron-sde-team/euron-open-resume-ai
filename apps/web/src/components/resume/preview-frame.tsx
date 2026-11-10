"use client";

import { useEffect, useRef, useState } from "react";
import { cn, Spinner } from "@open-resume/ui";

/** The width the templates are laid out for (US Letter at 96 dpi). */
const PAGE_WIDTH = 816;

/**
 * The resume itself, the one floating surface on the screen. The HTML comes from the
 * server renderer and is shown in an iframe with an empty `sandbox`: no scripts, no
 * forms, no same-origin access, whatever the resume contains. The page is scaled to fit
 * the column.
 */
export function PreviewFrame({ html, busy, error, className, title = "Resume preview" }: { html: string | null; busy?: boolean; error?: string | null; className?: string; title?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: PAGE_WIDTH, h: 1056 });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth || PAGE_WIDTH, h: el.clientHeight || 1056 });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const scale = Math.min(1, size.w / PAGE_WIDTH) || 1;

  return (
    <div ref={box} data-testid="preview-frame" className={cn("relative aspect-[8.5/11] w-full overflow-hidden rounded-card bg-white shadow-card ring-1 ring-border", className)}>
      {html ? (
        <iframe
          title={title}
          sandbox=""
          srcDoc={html}
          referrerPolicy="no-referrer"
          style={{ width: PAGE_WIDTH, height: size.h / scale, transform: `scale(${scale})`, transformOrigin: "top left" }}
          className="block border-0 bg-white"
        />
      ) : null}
      {!html && !error ? (
        <div className="absolute inset-0 flex items-center justify-center text-[13px] text-[#4b5563]">{busy ? <Spinner /> : "Nothing to show yet."}</div>
      ) : null}
      {error ? (
        <p role="alert" className="absolute inset-x-0 bottom-0 bg-white/95 px-3 py-2 text-[12.5px] text-[#b91c1c]">
          {error}
        </p>
      ) : null}
      {busy && html ? <span className="absolute right-3 top-3 text-[#4b5563]" aria-hidden><Spinner size="sm" /></span> : null}
    </div>
  );
}
