/**
 * Reads one uploaded file and a few small text fields from a multipart/form-data request,
 * entirely in memory and with hard limits: the file is cut off at `maxFileBytes` (the
 * request is then refused with 413 FILE_TOO_LARGE), and there is room for one file only.
 * The client's file name is cleaned to a plain base name; nothing from the request ever
 * becomes a storage path.
 */
import type { Request } from "express";
import Busboy from "busboy";
import path from "node:path";
import { HttpError, badRequest } from "../core/errors";

export interface UploadedFile {
  buffer: Buffer;
  /** Plain base name, at most 120 characters, no control characters. */
  fileName: string;
}

export interface MultipartForm {
  file: UploadedFile | null;
  fields: Record<string, string>;
}

export function cleanFileName(raw: string): string {
  // eslint-disable-next-line no-control-regex
  const base = path.basename(raw.replace(/\\/g, "/")).replace(/[\u0000-\u001F\u007F"<>|:*?]/g, "").trim();
  if (!base || base === "." || base === "..") return "resume";
  if (base.length <= 120) return base;
  const ext = path.extname(base);
  return base.slice(0, 120 - ext.length) + ext;
}

export function readMultipart(req: Request, opts: { maxFileBytes: number; maxFieldBytes?: number; fileField?: string }): Promise<MultipartForm> {
  const type = req.headers["content-type"] ?? "";
  if (!/^multipart\/form-data/i.test(type)) return Promise.reject(badRequest("Send the resume as multipart/form-data", "EXPECTED_MULTIPART"));
  const fileField = opts.fileField ?? "file";
  return new Promise((resolve, reject) => {
    let bb: ReturnType<typeof Busboy>;
    try {
      bb = Busboy({
        headers: req.headers,
        defParamCharset: "utf8",
        limits: { fileSize: opts.maxFileBytes, files: 1, fields: 12, fieldSize: opts.maxFieldBytes ?? 100_000, parts: 14 },
      });
    } catch {
      return reject(badRequest("Malformed upload", "BAD_MULTIPART"));
    }
    const fields: Record<string, string> = {};
    let file: UploadedFile | null = null;
    let tooLarge = false;
    let failure: HttpError | null = null;

    bb.on("field", (name, value, info) => {
      if (info.valueTruncated) failure ??= badRequest(`The field "${name}" is too long`, "FIELD_TOO_LONG");
      else fields[name] = value;
    });
    bb.on("file", (name, stream, info) => {
      if (name !== fileField) {
        stream.resume();
        return;
      }
      const chunks: Buffer[] = [];
      stream.on("data", (c: Buffer) => chunks.push(c));
      stream.on("limit", () => {
        tooLarge = true;
      });
      stream.on("end", () => {
        file = { buffer: Buffer.concat(chunks), fileName: cleanFileName(info.filename ?? "") };
      });
    });
    bb.on("filesLimit", () => {
      failure ??= badRequest("Send one file at a time", "TOO_MANY_FILES");
    });
    bb.on("error", () => reject(badRequest("Malformed upload", "BAD_MULTIPART")));
    bb.on("close", () => {
      if (tooLarge) {
        const mb = Math.max(1, Math.floor(opts.maxFileBytes / (1024 * 1024)));
        return reject(new HttpError(413, `That file is larger than ${mb} MB`, "FILE_TOO_LARGE", { limitMb: mb }));
      }
      if (failure) return reject(failure);
      resolve({ file, fields });
    });
    req.pipe(bb);
  });
}
