/**
 * Uploading a file to the API itself (multipart POST, the API checks size and type and
 * stores it). Progress is reported while the bytes go up (XMLHttpRequest, which every
 * browser and React Native supports); `fetch` cannot report upload progress.
 */
import { ApiError, networkError, toApiError } from "./errors";
import type { HttpClient } from "./http";

export interface UploadOptions {
  /** 0..1 as the bytes go up. */
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
  /** Injected for tests. */
  createXhr?: () => XMLHttpRequest;
}

const EXT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
  md: "text/markdown",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
};

/** The browser's type, or one inferred from the extension. */
export function mimeTypeOf(file: { type?: string; name?: string }): string {
  if (file.type) return file.type;
  const ext = (file.name ?? "").split(".").pop()?.toLowerCase() ?? "";
  return EXT_TYPES[ext] ?? "application/octet-stream";
}

/** POST a multipart form with upload progress. Resolves with the parsed JSON body. */
export async function postForm<T>(http: HttpClient, path: string, form: FormData, opts: UploadOptions = {}): Promise<T> {
  const token = await http.currentToken();
  return new Promise<T>((resolve, reject) => {
    const xhr = opts.createXhr ? opts.createXhr() : new XMLHttpRequest();
    xhr.open("POST", http.url(path));
    xhr.setRequestHeader("Accept", "application/json");
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) opts.onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      let payload: unknown;
      try {
        payload = xhr.responseText ? JSON.parse(xhr.responseText) : undefined;
      } catch {
        payload = undefined;
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(payload as T);
      else reject(toApiError(xhr.status, payload) ?? new ApiError({ status: xhr.status, message: "The upload was rejected", code: "UPLOAD_FAILED" }));
    };
    xhr.onerror = () => reject(networkError(new Error("upload failed")));
    xhr.onabort = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    opts.signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(form);
  });
}
