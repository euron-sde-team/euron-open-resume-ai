/**
 * Resume text extraction: file bytes in, plain text out. Local only: no OCR, no network.
 *
 *   sniffFile    decide what a file is from its bytes (the extension only separates txt from md)
 *   extractText  PDF via unpdf, DOCX via mammoth, txt and md as UTF-8
 *
 * The text is whitespace-collapsed and capped at MAX_TEXT_CHARS. A document that yields
 * fewer than MIN_TEXT_CHARS characters is almost certainly a scan or an image-only export;
 * it is refused with a clear message instead of sending nothing to the model.
 */
import path from "node:path";
import { extractText as pdfExtractText, getDocumentProxy } from "unpdf";
import mammoth from "mammoth";

export const MAX_TEXT_CHARS = 31_000;
export const MIN_TEXT_CHARS = 40;
/** A DOCX that expands past this is refused before it is opened (decompression bomb guard). */
const MAX_DOCX_UNCOMPRESSED = 60 * 1024 * 1024;

export type FileExt = "pdf" | "docx" | "txt" | "md";
export interface FileKind {
  ext: FileExt;
  mime: string;
}

const MIME: Record<FileExt, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
};

/** A problem with the file itself, with a message safe to show the user. Never retried. */
export class ExtractError extends Error {
  readonly retryable = false;
  constructor(
    readonly code: "UNSUPPORTED_FILE" | "UNREADABLE_FILE" | "NO_TEXT",
    message: string,
  ) {
    super(message);
    this.name = "ExtractError";
  }
}

/** Entry names and total uncompressed size from a zip's central directory, or null if it is not a zip. */
function zipDirectory(buf: Buffer): { names: string[]; uncompressed: number } | null {
  if (buf.length < 22 || buf.readUInt32LE(0) !== 0x04034b50) return null;
  // The end-of-central-directory record sits in the last 64 KiB + 22 bytes.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65_535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const names: string[] = [];
  let uncompressed = 0;
  for (let n = 0; n < count && n < 5000; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) return null;
    uncompressed += buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    if (p + 46 + nameLen > buf.length) return null;
    names.push(buf.toString("utf8", p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return { names, uncompressed };
}

function looksLikeText(buf: Buffer): boolean {
  if (buf.subarray(0, 8192).includes(0)) return false;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  // A sample is enough; a multi-byte character cut by the sample edge is allowed (up to 3 bytes).
  const sample = buf.subarray(0, 65_536);
  for (let trim = 0; trim <= (buf.length > sample.length ? 3 : 0); trim++) {
    try {
      decoder.decode(sample.subarray(0, sample.length - trim));
      return true;
    } catch {
      /* try again with fewer trailing bytes */
    }
  }
  return false;
}

/** What the bytes are, or null for an unsupported file. The file name only picks txt vs md. */
export function sniffFile(buf: Buffer, fileName: string): FileKind | null {
  if (buf.length === 0) return null;
  if (buf.subarray(0, 1024).includes("%PDF-")) return { ext: "pdf", mime: MIME.pdf };
  if (buf.length >= 4 && buf.readUInt32BE(0) === 0x504b0304) {
    const zip = zipDirectory(buf);
    if (zip?.names.includes("word/document.xml")) return { ext: "docx", mime: MIME.docx };
    return null;
  }
  const ext = path.extname(fileName).toLowerCase();
  if ((ext === ".txt" || ext === ".md" || ext === ".markdown") && looksLikeText(buf)) {
    return ext === ".txt" ? { ext: "txt", mime: MIME.txt } : { ext: "md", mime: MIME.md };
  }
  return null;
}

/** Collapse whitespace the way a model prompt wants it: single spaces, at most one blank line. */
export function collapseWhitespace(text: string): string {
  return (
    text
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
      .replace(/\r\n?/g, "\n")
      .replace(/[\t\u00A0\u2000-\u200B\u202F\u205F\u3000\uFEFF]/g, " ")
      .replace(/[ ]{2,}/g, " ")
      .split("\n")
      .map((l) => l.trim())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

async function pdfText(buf: Buffer): Promise<string> {
  // unpdf wants its own copy: pdf.js transfers the underlying buffer.
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await pdfExtractText(pdf, { mergePages: true });
  return Array.isArray(text) ? text.join("\n") : text;
}

async function docxText(buf: Buffer): Promise<string> {
  const zip = zipDirectory(buf);
  if (!zip || !zip.names.includes("word/document.xml")) throw new ExtractError("UNSUPPORTED_FILE", "That is not a valid Word document.");
  if (zip.uncompressed > MAX_DOCX_UNCOMPRESSED) throw new ExtractError("UNREADABLE_FILE", "That document expands to an unreasonable size.");
  return (await mammoth.extractRawText({ buffer: buf })).value;
}

export async function extractText(buf: Buffer, kind: FileKind): Promise<string> {
  let raw: string;
  try {
    raw = kind.ext === "pdf" ? await pdfText(buf) : kind.ext === "docx" ? await docxText(buf) : buf.toString("utf8");
  } catch (err) {
    if (err instanceof ExtractError) throw err;
    throw new ExtractError("UNREADABLE_FILE", "We could not read that file. Try exporting it again, or upload a DOCX or TXT version.");
  }
  const text = collapseWhitespace(raw);
  if (text.length < MIN_TEXT_CHARS) {
    throw new ExtractError("NO_TEXT", "We found almost no text in that file. It looks like a scan or an image; export a text-based PDF or upload a DOCX or TXT version.");
  }
  return text.length > MAX_TEXT_CHARS ? text.slice(0, MAX_TEXT_CHARS) : text;
}
