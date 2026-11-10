"use client";

import { useRef, useState, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { FileUp } from "lucide-react";
import { Button, cn, Field, Input, Textarea } from "@open-resume/ui";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { qk } from "@/lib/query-keys";
import { isQuotaError } from "@/lib/resume/quota";
import { ACCEPT_ATTR, effectiveMaxMb, formatBytes, validateResumeFile } from "@/lib/resume/upload-validation";
import { PageFrame, PageHeading } from "./page-frame";
import { QuotaNotice, useQuota } from "./quota-notice";

export function UploadView() {
  const router = useRouter();
  const qc = useQueryClient();
  const { quota } = useQuota();
  const maxMb = effectiveMaxMb(quota.maxUploadMb);
  const input = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [company, setCompany] = useState("");
  const [jd, setJd] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = progress !== null;

  const pick = (f: File | null | undefined) => {
    setError(null);
    if (!f) return;
    const check = validateResumeFile(f, quota.maxUploadMb);
    if (!check.ok) {
      setFile(null);
      setProblem(check.message ?? "That file cannot be used.");
      return;
    }
    setProblem(null);
    setFile(f);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (!busy) pick(e.dataTransfer.files?.[0]);
  };

  const submit = async () => {
    if (!file || busy) return;
    setError(null);
    setProgress(0);
    abort.current = new AbortController();
    try {
      const created = await api().resumes.upload({ file, jd, company }, { onProgress: setProgress, signal: abort.current.signal });
      void qc.invalidateQueries({ queryKey: qk.resumes });
      void qc.invalidateQueries({ queryKey: qk.usage });
      router.push(`/resumes/${created.id}`);
    } catch (e) {
      setProgress(null);
      if ((e as Error).name === "AbortError") return;
      setError(isQuotaError(e) ? "Your monthly runs are used up, so this resume cannot be analysed right now." : errorMessage(e));
      void qc.invalidateQueries({ queryKey: qk.usage });
    }
  };

  return (
    <PageFrame>
      <PageHeading title="Upload a resume" testId="upload-title" meta="Get a score, an improved version, a cover letter and interview prep." />

      <label
        data-testid="dropzone"
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-card border border-dashed border-input px-6 py-12 text-center transition-colors focus-within:ring-2 focus-within:ring-ring hover:bg-muted/50",
          over && "bg-muted",
          busy && "pointer-events-none opacity-70",
        )}
      >
        <input ref={input} data-testid="file-input" type="file" accept={ACCEPT_ATTR} className="sr-only" aria-label="Resume file" disabled={busy} onChange={(e) => pick(e.target.files?.[0])} />
        <FileUp className="size-6 text-muted-foreground" aria-hidden />
        {file ? (
          <>
            <span data-testid="file-name" className="text-[15px] font-medium">
              {file.name}
            </span>
            <span className="text-[13px] text-muted-foreground">{formatBytes(file.size)} · Choose another file to replace it</span>
          </>
        ) : (
          <>
            <span className="text-[15px] font-medium">Drop your resume here, or choose a file</span>
            <span className="text-[13px] text-muted-foreground">PDF, DOCX, TXT or Markdown, up to {maxMb} MB</span>
          </>
        )}
      </label>
      {problem ? (
        <p role="alert" data-testid="upload-problem" className="mt-2 text-[13.5px] font-medium text-danger">
          {problem}
        </p>
      ) : null}

      <div className="mt-8 space-y-5">
        <Field label="Company" htmlFor="company" optional>
          <Input id="company" value={company} maxLength={120} onChange={(e) => setCompany(e.target.value)} disabled={busy} placeholder="Where you are applying" />
        </Field>
        <Field label="Job description" htmlFor="jd" optional hint="Add it to see which keywords you are missing and to get a version written for that role.">
          <Textarea id="jd" rows={7} value={jd} maxLength={20000} onChange={(e) => setJd(e.target.value)} disabled={busy} placeholder="Paste the posting here" />
        </Field>
      </div>

      <div className="mt-8 space-y-3">
        <QuotaNotice quota={quota} cost />
        {busy ? (
          <div>
            <div role="progressbar" aria-label="Upload progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((progress ?? 0) * 100)} className="h-[3px] w-full rounded-full bg-border">
              <div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${Math.round((progress ?? 0) * 100)}%` }} />
            </div>
            <p role="status" className="mt-2 text-[13px] text-muted-foreground">
              {(progress ?? 0) < 1 ? `Uploading ${Math.round((progress ?? 0) * 100)}%` : "Starting the analysis"}
            </p>
          </div>
        ) : null}
        {error ? (
          <p role="alert" data-testid="upload-error" className="text-[13.5px] font-medium text-danger">
            {error}
          </p>
        ) : null}
        <div className="flex items-center gap-2">
          <Button data-testid="upload-submit" disabled={!file || busy || quota.exhausted} loading={busy} onClick={() => void submit()}>
            Analyse resume
          </Button>
          {busy ? (
            <Button variant="ghost" onClick={() => abort.current?.abort()}>
              Cancel
            </Button>
          ) : null}
        </div>
      </div>
    </PageFrame>
  );
}
