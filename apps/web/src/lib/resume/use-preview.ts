"use client";

import { useEffect, useState } from "react";
import type { ResumeDocument, TemplateId } from "@open-resume/types";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { useDebounced } from "@/lib/hooks/use-debounced";

/** Server-rendered HTML of a document with a template, debounced while the person types. */
export function usePreviewHtml(document: ResumeDocument | null, templateId: TemplateId, opts: { delay?: number; enabled?: boolean } = {}) {
  const key = document ? JSON.stringify(document) : "";
  const debouncedKey = useDebounced(key, opts.delay ?? 450);
  const [state, setState] = useState<{ html: string | null; busy: boolean; error: string | null }>({ html: null, busy: false, error: null });
  const enabled = opts.enabled ?? true;

  useEffect(() => {
    if (!enabled || !debouncedKey) return;
    const ctrl = new AbortController();
    setState((s) => ({ ...s, busy: true, error: null }));
    api()
      .builder.render(JSON.parse(debouncedKey) as ResumeDocument, templateId, ctrl.signal)
      .then((html) => setState({ html: typeof html === "string" ? html : null, busy: false, error: null }))
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return;
        setState((s) => ({ ...s, busy: false, error: errorMessage(e) }));
      });
    return () => ctrl.abort();
  }, [debouncedKey, templateId, enabled]);

  return state;
}

/** The improved resume of a stored resume in another template (GET /resumes/:id/render). */
export function useResumeRender(id: string, templateId: TemplateId, enabled: boolean) {
  const [state, setState] = useState<{ html: string | null; busy: boolean; error: string | null }>({ html: null, busy: false, error: null });
  useEffect(() => {
    if (!enabled) return;
    const ctrl = new AbortController();
    setState((s) => ({ ...s, busy: true, error: null }));
    api()
      .resumes.render(id, templateId, ctrl.signal)
      .then((html) => setState({ html: typeof html === "string" ? html : null, busy: false, error: null }))
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return;
        setState((s) => ({ ...s, busy: false, error: errorMessage(e) }));
      });
    return () => ctrl.abort();
  }, [id, templateId, enabled]);
  return state;
}
