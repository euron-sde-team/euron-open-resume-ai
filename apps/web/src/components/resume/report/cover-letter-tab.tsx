"use client";

import { Download } from "lucide-react";
import type { ResumeDetail } from "@open-resume/types";
import { Button } from "@open-resume/ui";
import { api } from "@/lib/api";
import { fileNameFor } from "@/lib/resume/format";
import { useDownload } from "@/lib/resume/use-download";
import { Prose } from "./bits";

export function CoverLetterTab({ detail }: { detail: ResumeDetail }) {
  const dl = useDownload();
  const c = detail.coverLetter;
  if (!c) return <Prose>The cover letter is written with the improved resume. It appears here when ready.</Prose>;
  const h = c.header ?? {};
  const head = [h.name, h.email, h.phone, h.location].filter(Boolean).join(" · ");
  return (
    <div data-testid="cover-letter-tab">
      <div className="mb-6 flex gap-2">
        <Button size="sm" loading={dl.busy === "pdf"} onClick={() => void dl.run("pdf", fileNameFor(`${detail.title}_cover_letter`, "pdf"), () => api().resumes.download(detail.id, "cover-letter.pdf"))}>
          <Download /> PDF
        </Button>
        <Button size="sm" variant="outline" loading={dl.busy === "docx"} onClick={() => void dl.run("docx", fileNameFor(`${detail.title}_cover_letter`, "docx"), () => api().resumes.download(detail.id, "cover-letter.docx"))}>
          <Download /> DOCX
        </Button>
      </div>
      <article className="max-w-[68ch] text-[15px] leading-[1.75]">
        {head ? <p className="text-[13px] text-muted-foreground">{head}</p> : null}
        {h.date || h.recipient || h.company ? <p className="mt-3 text-[13px] text-muted-foreground">{[h.date, h.recipient, h.company].filter(Boolean).join(" · ")}</p> : null}
        {c.greeting ? <p className="mt-6">{c.greeting}</p> : null}
        {c.paragraphs.map((p, i) => (
          <p key={i} className="mt-4">
            {p}
          </p>
        ))}
        {c.closing ? <p className="mt-6 whitespace-pre-line">{c.closing}</p> : null}
      </article>
    </div>
  );
}
