"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import type { ResumeDetail } from "@open-resume/types";
import { Button, Field, Input, Textarea } from "@open-resume/ui";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { qk } from "@/lib/query-keys";
import { QuotaNotice, useQuota } from "../quota-notice";
import { Prose } from "./bits";

export function TailorTab({ detail }: { detail: ResumeDetail }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { quota } = useQuota();
  const [jd, setJd] = useState(detail.jd ?? "");
  const [company, setCompany] = useState(detail.company ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await api().resumes.tailor(detail.id, { jd: jd.trim(), company: company.trim() || undefined });
      void qc.invalidateQueries({ queryKey: qk.resumes });
      void qc.invalidateQueries({ queryKey: qk.usage });
      router.push(`/resumes/${created.id}`);
    } catch (e) {
      setBusy(false);
      setError(errorMessage(e));
    }
  };

  return (
    <div data-testid="tailor-tab" className="max-w-[640px]">
      <Prose>Paste a job description to get a new copy of this resume, rewritten and scored for that role. The original stays as it is.</Prose>
      {detail.parentId ? (
        <p className="mt-2 text-[13.5px] text-muted-foreground">
          This resume was tailored from{" "}
          <Link href={`/resumes/${detail.parentId}`} className="text-link underline-offset-4 hover:underline">
            another one
          </Link>
          .
        </p>
      ) : null}
      <div className="mt-6 space-y-5">
        <Field label="Company" htmlFor="tailor-company" optional>
          <Input id="tailor-company" value={company} maxLength={120} onChange={(e) => setCompany(e.target.value)} />
        </Field>
        <Field label="Job description" htmlFor="tailor-jd">
          <Textarea id="tailor-jd" rows={9} value={jd} maxLength={20000} onChange={(e) => setJd(e.target.value)} placeholder="Paste the posting here" />
        </Field>
      </div>
      <div className="mt-6 space-y-3">
        <QuotaNotice quota={quota} cost />
        {error ? (
          <p role="alert" className="text-[13.5px] font-medium text-danger">
            {error}
          </p>
        ) : null}
        <Button data-testid="tailor-submit" disabled={jd.trim().length < 20 || quota.exhausted} loading={busy} onClick={() => void submit()}>
          Create tailored resume
        </Button>
      </div>
    </div>
  );
}
