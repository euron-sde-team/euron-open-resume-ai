"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Search } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  NativeSelect,
  Skeleton,
  toast,
} from "@open-resume/ui";
import { UnderlineTabs } from "@/components/common/underline-tabs";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { qk } from "@/lib/query-keys";
import { documentFromSample } from "@/lib/resume/document";
import { asTemplateId, metaLine } from "@/lib/resume/format";
import { useDebounced } from "@/lib/hooks/use-debounced";
import { usePreviewHtml } from "@/lib/resume/use-preview";
import { PageFrame, PageHeading } from "./page-frame";
import { PreviewFrame } from "./preview-frame";

type Samples = typeof import("@open-resume/samples");
type Sample = Samples["samples"][number];
type Level = "all" | "fresher" | "mid" | "senior";

const LEVELS: { value: Level; label: string }[] = [
  { value: "all", label: "All levels" },
  { value: "fresher", label: "Fresher" },
  { value: "mid", label: "Mid-level" },
  { value: "senior", label: "Senior" },
];
const LEVEL_WORD: Record<string, string> = {
  fresher: "Fresher",
  mid: "Mid-level",
  senior: "Senior",
};

function SamplePreview({ sample, onClose }: { sample: Sample | null; onClose: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const doc = useMemo(
    () => (sample ? documentFromSample(sample as unknown as Record<string, unknown>) : null),
    [sample]
  );
  const templateId = asTemplateId(sample?.suggestedTemplate);
  const preview = usePreviewHtml(doc, templateId, { delay: 0, enabled: !!sample });

  const use = async () => {
    if (!sample || !doc) return;
    setBusy(true);
    try {
      const draft = await api().drafts.create({
        name: `${sample.personal.fullName}, ${sample.role}`,
        templateId,
        document: doc,
      });
      void qc.invalidateQueries({ queryKey: qk.drafts });
      router.push(`/builder?draft=${encodeURIComponent(draft.id)}`);
    } catch (e) {
      setBusy(false);
      toast.error({ title: errorMessage(e) });
    }
  };

  return (
    <Dialog open={!!sample} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent size="lg" data-testid="sample-dialog">
        <DialogHeader>
          <DialogTitle>{sample?.role}</DialogTitle>
          <DialogDescription>
            {sample ? metaLine([LEVEL_WORD[sample.level], sample.field, "Fictional person"]) : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto bg-ground-2/40 px-5 py-5">
          <div className="mx-auto max-w-[560px]">
            <PreviewFrame
              html={preview.html}
              busy={preview.busy}
              error={preview.error}
              title={`Sample resume, ${sample?.role ?? ""}`}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Close
          </Button>
          <Button loading={busy} onClick={() => void use()} data-testid="sample-use">
            Use as a starting point
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SamplesView() {
  const [lib, setLib] = useState<Samples | null>(null);
  const [q, setQ] = useState("");
  const [field, setField] = useState("");
  const [level, setLevel] = useState<Level>("all");
  const [open, setOpen] = useState<Sample | null>(null);
  const search = useDebounced(q, 150);

  // The library is a few hundred KB of JSON; load it when this screen opens, not with the app.
  useEffect(() => {
    let live = true;
    void import("@open-resume/samples").then((m) => live && setLib(m));
    return () => {
      live = false;
    };
  }, []);

  const fields = useMemo(
    () => (lib ? [...new Set(lib.samples.map((s) => s.field))].sort() : []),
    [lib]
  );
  const list = useMemo(
    () =>
      lib
        ? lib.listSamples({
            q: search,
            field: field || undefined,
            level: level === "all" ? undefined : level,
          })
        : [],
    [lib, search, field, level]
  );

  return (
    <PageFrame>
      <PageHeading
        title="Samples"
        testId="samples-title"
        meta="Fictional resumes to start from. Pick one, then make it yours in the builder."
      />
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] flex-1">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle-foreground"
          />
          <Input
            type="search"
            aria-label="Search samples by role, field or skill"
            data-testid="samples-search"
            placeholder="Search by role, field or skill"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-9"
          />
        </div>
        <NativeSelect
          aria-label="Field"
          value={field}
          onChange={(e) => setField(e.target.value)}
          className="w-52"
          data-testid="samples-field"
        >
          <option value="">All fields</option>
          {fields.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </NativeSelect>
      </div>
      <UnderlineTabs
        label="Level"
        size="sm"
        idPrefix="level"
        value={level}
        onChange={setLevel}
        tabs={LEVELS}
        className="mb-2"
      />
      <div id="level-panel" role="tabpanel" aria-labelledby={`level-tab-${level}`}>
        <p
          className="mb-2 mt-3 text-[13px] text-muted-foreground"
          role="status"
          data-testid="samples-count"
        >
          {lib ? `${list.length} ${list.length === 1 ? "sample" : "samples"}` : "Loading"}
        </p>
        {!lib ? (
          <div className="space-y-3" aria-busy="true">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : list.length === 0 ? (
          <p className="py-10 text-[14.5px] text-muted-foreground">
            Nothing matches. Try a broader search, or clear the filters.
          </p>
        ) : (
          <ul className="border-t border-border" data-testid="samples-list">
            {list.map((s) => (
              <li key={s.id} className="border-b border-border">
                <button
                  type="button"
                  onClick={() => setOpen(s)}
                  className="flex w-full items-baseline justify-between gap-4 py-3.5 text-left hover:bg-muted/50 focus-visible:rounded-sm"
                  data-testid="sample-row"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] font-medium">{s.role}</span>
                    <span className="block truncate text-[13px] text-muted-foreground">
                      {s.personal.headline}
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-[13px] text-muted-foreground">
                    {metaLine([LEVEL_WORD[s.level], s.field])}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <SamplePreview sample={open} onClose={() => setOpen(null)} />
    </PageFrame>
  );
}
