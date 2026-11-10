/**
 * Text out of an uploaded resume for the chat builder's import route: PDF (unpdf), DOCX
 * (mammoth), plain text and Markdown. The type is decided by the file's bytes, never by
 * its name or the client's content type. A private helper; the resume pipeline has its own.
 */
import mammoth from "mammoth";
import { badRequest, HttpError } from "../../../core/errors";
import { LIMITS, clip } from "./limits";

export type ImportKind = "pdf" | "docx" | "text";

export function sniffKind(buf: Buffer, fileName: string): ImportKind | null {
  if (buf.length >= 5 && buf.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) return /\.docx$/i.test(fileName) ? "docx" : null;
  if (/\.(txt|md|markdown)$/i.test(fileName)) {
    const head = buf.subarray(0, 4096);
    if (head.includes(0)) return null;
    return "text";
  }
  return null;
}

export async function extractText(buf: Buffer, kind: ImportKind): Promise<string> {
  try {
    if (kind === "pdf") {
      const { getDocumentProxy, extractText: pdfText } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(buf));
      const { text } = await pdfText(pdf, { mergePages: true });
      return Array.isArray(text) ? text.join("\n") : text;
    }
    if (kind === "docx") return (await mammoth.extractRawText({ buffer: buf })).value;
    return buf.toString("utf8");
  } catch {
    throw badRequest("We could not read that file. Try a different export of it.", "UNREADABLE_FILE");
  }
}

/** Collapse whitespace noise and cap length; reject files with (almost) no text. */
export function cleanExtracted(raw: string): string {
  const text = clip(
    raw
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t\f\u00a0]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n"),
    LIMITS.resumeChars,
  );
  if (text.length < 40) throw new HttpError(422, "That file has almost no readable text. If it is a scan, upload a text-based PDF or paste the text instead.", "NO_TEXT");
  return text;
}
