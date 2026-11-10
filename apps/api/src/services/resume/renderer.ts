/**
 * The seam between the resume pipeline and document rendering (HTML preview, PDF, DOCX).
 * Implemented in services/resume/render/*. Pure functions of their input: no database, no
 * storage, no network (the PDF engine blocks it).
 */
import type { CoverLetter, ResumeDocument, TemplateId, TemplateInfo } from "@open-resume/types";

export interface ResumeRenderer {
  listTemplates(): TemplateInfo[];
  /** Unknown ids fall back to the default template; never a path. */
  resolveTemplate(id: string | undefined): TemplateId;
  /** A complete, self-contained HTML document (inline CSS, no scripts, no network). */
  renderHtml(document: ResumeDocument, templateId: TemplateId): Promise<string>;
  renderPdf(document: ResumeDocument, templateId: TemplateId): Promise<Buffer>;
  renderDocx(document: ResumeDocument, templateId: TemplateId): Promise<Buffer>;
  renderCoverLetterPdf(letter: CoverLetter, author: ResumeDocument): Promise<Buffer>;
  renderCoverLetterDocx(letter: CoverLetter, author: ResumeDocument): Promise<Buffer>;
}
