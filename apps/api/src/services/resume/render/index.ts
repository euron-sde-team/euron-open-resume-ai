/** The rendering slice: implements the `ResumeRenderer` seam (services/resume/renderer.ts). */
import type { CoverLetter, ResumeDocument, TemplateId } from "@open-resume/types";
import type { ResumeRenderer } from "../renderer";
import { buildCoverLetterDocx, buildResumeDocx } from "./docx";
import { renderCoverLetterHtml, renderResumeHtml } from "./html";
import { htmlToPdf } from "./pdf";
import { listTemplateInfo, resolveTemplateId } from "./registry";

export { closePdfBrowser, findChromium, PdfUnavailableError } from "./pdf";
export { DOCUMENT_CSP } from "./html";
export { safeHref, cleanUrl, safeDataImage } from "./safe";

export const resumeRenderer: ResumeRenderer = {
  listTemplates: listTemplateInfo,
  resolveTemplate: resolveTemplateId,
  async renderHtml(document: ResumeDocument, templateId: TemplateId) {
    return renderResumeHtml(document, resolveTemplateId(templateId));
  },
  async renderPdf(document: ResumeDocument, templateId: TemplateId) {
    return htmlToPdf(renderResumeHtml(document, resolveTemplateId(templateId)));
  },
  async renderDocx(document: ResumeDocument, templateId: TemplateId) {
    return buildResumeDocx(document, resolveTemplateId(templateId));
  },
  async renderCoverLetterPdf(letter: CoverLetter, author: ResumeDocument) {
    return htmlToPdf(renderCoverLetterHtml(letter, author));
  },
  async renderCoverLetterDocx(letter: CoverLetter, author: ResumeDocument) {
    return buildCoverLetterDocx(letter, author);
  },
};
