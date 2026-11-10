import { describe, expect, it, vi } from "vitest";
import { HttpClient, isApiError, mimeTypeOf, postForm } from "../src";

class FakeXhr {
  method = "";
  url = "";
  headers: Record<string, string> = {};
  status = 0;
  responseText = "";
  body: unknown;
  upload: { onprogress: ((e: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  constructor(private readonly outcome: { status: number; body?: unknown } | "error") {}
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(k: string, v: string) {
    this.headers[k] = v;
  }
  abort() {
    this.onabort?.();
  }
  send(body: unknown) {
    this.body = body;
    queueMicrotask(() => {
      this.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 } as ProgressEvent);
      if (this.outcome === "error") return this.onerror?.();
      this.status = this.outcome.status;
      this.responseText = this.outcome.body === undefined ? "" : JSON.stringify(this.outcome.body);
      this.onload?.();
    });
  }
}

const http = () => new HttpClient({ baseUrl: "https://app.example.com/api", getAccessToken: () => "tok", fetch: vi.fn() as unknown as typeof fetch });
const form = () => {
  const f = new FormData();
  f.append("file", new Blob(["hello"], { type: "text/plain" }), "a.txt");
  return f;
};

describe("mimeTypeOf", () => {
  it("prefers the browser type and falls back to the extension", () => {
    expect(mimeTypeOf({ type: "application/pdf", name: "x.bin" })).toBe("application/pdf");
    expect(mimeTypeOf({ name: "Resume.DOCX" })).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(mimeTypeOf({ name: "noext" })).toBe("application/octet-stream");
  });
});

describe("postForm", () => {
  it("posts the form with the bearer token, reports progress and resolves with the JSON body", async () => {
    const xhr = new FakeXhr({ status: 201, body: { id: "r1" } });
    const progress: number[] = [];
    const body = await postForm<{ id: string }>(http(), "/resumes/upload", form(), { onProgress: (f) => progress.push(f), createXhr: () => xhr as unknown as XMLHttpRequest });
    expect(body).toEqual({ id: "r1" });
    expect(progress).toEqual([0.5]);
    expect(xhr.method).toBe("POST");
    expect(xhr.url).toBe("https://app.example.com/api/resumes/upload");
    expect(xhr.headers.Authorization).toBe("Bearer tok");
    expect(xhr.body).toBeInstanceOf(FormData);
  });

  it("turns an error response into an ApiError with the server's code", async () => {
    const xhr = new FakeXhr({ status: 413, body: { error: "Too big", code: "FILE_TOO_LARGE" } });
    const err = await postForm<never>(http(), "/x", form(), { createXhr: () => xhr as unknown as XMLHttpRequest }).catch((e: unknown) => e as { code: string; name: string });
    expect(isApiError(err)).toBe(true);
    expect(err).toMatchObject({ status: 413, code: "FILE_TOO_LARGE" });
  });

  it("maps a network failure and an abort", async () => {
    const bad = await postForm<never>(http(), "/x", form(), { createXhr: () => new FakeXhr("error") as unknown as XMLHttpRequest }).catch((e: unknown) => e as { code: string; name: string });
    expect(isApiError(bad)).toBe(true);
    expect(bad.code).toBe("NETWORK_ERROR");
    const ctl = new AbortController();
    const xhr = new FakeXhr({ status: 200 });
    xhr.send = () => undefined;
    const p = postForm<never>(http(), "/x", form(), { signal: ctl.signal, createXhr: () => xhr as unknown as XMLHttpRequest }).catch((e: unknown) => e as { code: string; name: string });
    await Promise.resolve();
    ctl.abort();
    expect((await p).name).toBe("AbortError");
  });
});
