/**
 * EJS rendering. Templates are read once from the templates directory, compiled once, and
 * rendered with `safeHref` in scope. A template id is only ever a key into the allow-list
 * (registry.ts), never part of a path.
 */
import ejs from "ejs";
import fs from "node:fs";
import path from "node:path";
import { config } from "../../../core/config";
import type { CoverLetter, ResumeDocument, TemplateId } from "@open-resume/types";
import { fontAwesomeStyle, fontFaceStyle } from "./assets";
import { toCoverLetterTemplateData, toResumeTemplateData } from "./mapper";
import { TEMPLATE_SPECS } from "./registry";
import { escapeHtml, safeHref } from "./safe";

/** The CSP every rendered document carries (as a meta tag) and every HTTP response repeats. */
export const DOCUMENT_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:";

let templatesDir: string | null = null;

/** `TEMPLATES_DIR`, else the first existing of the source tree and the bundle layout. */
export function resolveTemplatesDir(): string {
  if (templatesDir) return templatesDir;
  const candidates = [
    config.TEMPLATES_DIR,
    path.resolve(__dirname, "../../../templates"),
    path.resolve(__dirname, "templates"),
    path.resolve(__dirname, "../templates"),
    path.resolve(process.cwd(), "apps/api/src/templates"),
    path.resolve(process.cwd(), "src/templates"),
    path.resolve(process.cwd(), "templates"),
  ].filter((c): c is string => !!c);
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "resume_template.ejs"))) return (templatesDir = dir);
  }
  throw new Error(`resume templates not found (looked in: ${candidates.join(", ")}); set TEMPLATES_DIR`);
}

const compiled = new Map<string, ejs.TemplateFunction>();

function compile(file: "cover_letter" | TemplateId): ejs.TemplateFunction {
  let fn = compiled.get(file);
  if (!fn) {
    const source = fs.readFileSync(path.join(resolveTemplatesDir(), `${file}.ejs`), "utf8");
    fn = ejs.compile(source, { filename: path.join(resolveTemplatesDir(), `${file}.ejs`), rmWhitespace: false });
    compiled.set(file, fn);
  }
  return fn;
}

/** Inline CSS, fonts and the CSP into the rendered page. */
function finish(html: string, fonts: ("lato" | "merriweather")[] | undefined): string {
  const inject = `<meta http-equiv="Content-Security-Policy" content="${escapeHtml(DOCUMENT_CSP)}">${fontAwesomeStyle()}${fontFaceStyle(fonts)}`;
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => `${m}\n${inject}`) : `${inject}${html}`;
}

export function renderResumeHtml(document: ResumeDocument, templateId: TemplateId): string {
  const html = compile(templateId)({ data: toResumeTemplateData(document), safeHref });
  return finish(html, TEMPLATE_SPECS[templateId].fonts);
}

export function renderCoverLetterHtml(letter: CoverLetter, author: ResumeDocument): string {
  const html = compile("cover_letter")({ data: toCoverLetterTemplateData(letter, author), safeHref });
  return finish(html, undefined);
}
