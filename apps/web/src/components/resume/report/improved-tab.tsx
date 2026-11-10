"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import type { ResumeDetail, TemplateId } from "@open-resume/types";
import { Button } from "@open-resume/ui";
import { api } from "@/lib/api";
import { fileNameFor } from "@/lib/resume/format";
import { useDownload } from "@/lib/resume/use-download";
import { useResumeRender } from "@/lib/resume/use-preview";
import { PreviewFrame } from "../preview-frame";
import { TemplateChooser } from "../template-chooser";
import { Prose } from "./bits";
import type { Actions } from "./on-demand";

export function ImprovedTab({ detail, actions }: { detail: ResumeDetail; actions: Actions }) {
  const [templateId, setTemplateId] = useState<TemplateId>(detail.templateId);
  const ready = !!detail.improved;
  const render = useResumeRender(detail.id, templateId, ready);
  const dl = useDownload();
  const rewrite = detail.components?.rewrite;

  if (!ready) {
    return rewrite?.status === "failed" ? (
      <div role="alert">
        <p className="text-[14px] font-medium text-danger">The improved resume could not be written.{rewrite.error ? ` ${rewrite.error}` : ""}</p>
        <Button className="mt-3" variant="outline" size="sm" loading={actions.busy} onClick={() => actions.retry("rewrite")}>
          Try again
        </Button>
      </div>
    ) : (
      <Prose>The improved resume is being written. This page updates when it is ready.</Prose>
    );
  }

  const file = (ext: string, suffix = "") => fileNameFor(`${detail.title}${suffix}`, ext);
  return (
    <div data-testid="improved-tab">
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <TemplateChooser value={templateId} onChange={setTemplateId} />
        <span className="flex-1" />
        <Button size="sm" loading={dl.busy === "pdf"} onClick={() => void dl.run("pdf", file("pdf"), () => api().resumes.download(detail.id, "resume.pdf", templateId))} data-testid="download-pdf">
          <Download /> PDF
        </Button>
        <Button size="sm" variant="outline" loading={dl.busy === "docx"} onClick={() => void dl.run("docx", file("docx"), () => api().resumes.download(detail.id, "resume.docx"))} data-testid="download-docx">
          <Download /> DOCX
        </Button>
        {detail.coverLetter ? (
          <>
            <Button size="sm" variant="outline" loading={dl.busy === "cl-pdf"} onClick={() => void dl.run("cl-pdf", file("pdf", "_cover_letter"), () => api().resumes.download(detail.id, "cover-letter.pdf"))} data-testid="download-cover-pdf">
              Cover letter PDF
            </Button>
            <Button size="sm" variant="outline" loading={dl.busy === "cl-docx"} onClick={() => void dl.run("cl-docx", file("docx", "_cover_letter"), () => api().resumes.download(detail.id, "cover-letter.docx"))} data-testid="download-cover-docx">
              Cover letter DOCX
            </Button>
          </>
        ) : null}
        {detail.fileName ? (
          <Button size="sm" variant="ghost" loading={dl.busy === "orig"} onClick={() => void dl.run("orig", detail.fileName ?? "original", () => api().resumes.download(detail.id, "original"))}>
            Original file
          </Button>
        ) : null}
      </div>
      <div className="mx-auto max-w-[640px]">
        <PreviewFrame html={render.html} busy={render.busy} error={render.error} title={`Improved resume, ${templateId}`} />
      </div>
    </div>
  );
}
