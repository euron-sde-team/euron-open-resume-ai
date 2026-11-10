import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PreviewFrame } from "@/components/resume/preview-frame";
import { SimpleText, parseBlocks } from "@/components/resume/simple-text";
import { UploadView } from "@/components/resume/upload-view";
import { SectionEditor } from "@/components/resume/builder/section-editor";
import { templateList } from "@/components/resume/template-chooser";
import { documentFromSample, hasContent, parseCsv, parseLines } from "@/lib/resume/document";

const push = vi.fn();
const upload = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn() }), usePathname: () => "/resumes/new", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/api", () => ({
  api: () => ({
    me: { usage: async () => ({ runs: { used: 2, limit: 10, resetsAt: "2026-12-01T00:00:00.000Z" }, maxUploadMb: 3 }) },
    resumes: { upload },
  }),
}));

function withQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("PreviewFrame", () => {
  it("shows the resume in an iframe with an empty sandbox and no network referrer", () => {
    render(<PreviewFrame html="<p>Hi</p>" />);
    const frame = screen.getByTitle("Resume preview");
    expect(frame.tagName).toBe("IFRAME");
    expect(frame.getAttribute("sandbox")).toBe("");
    expect(frame.getAttribute("srcdoc")).toBe("<p>Hi</p>");
    expect(frame.getAttribute("src")).toBeNull();
  });

  it("says so when there is nothing to show", () => {
    render(<PreviewFrame html={null} />);
    expect(screen.getByText("Nothing to show yet.")).toBeInTheDocument();
  });
});

describe("SimpleText", () => {
  it("renders paragraphs, lists and code as elements, never as markup", () => {
    const { container } = render(<SimpleText>{"Use `map` here.\n\n- one\n- two\n\n```\n<script>alert(1)</script>\n```\n<img src=x onerror=alert(1)>"}</SimpleText>);
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelector("code")?.textContent).toBe("map");
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("pre")?.textContent).toContain("<script>alert(1)</script>");
    expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
  });

  it("splits blocks", () => {
    expect(parseBlocks("a\nb\n\n1. x\n2. y").map((b) => b.kind)).toEqual(["p", "ul"]);
  });
});

describe("UploadView", () => {
  beforeEach(() => {
    push.mockReset();
    upload.mockReset();
  });

  it("refuses a file of the wrong type before sending it", async () => {
    withQuery(<UploadView />);
    const input = screen.getByTestId("file-input") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "cv.exe")] } });
    expect(await screen.findByTestId("upload-problem")).toHaveTextContent("Upload a PDF, DOCX, TXT or Markdown file.");
    expect(screen.getByTestId("upload-submit")).toBeDisabled();
  });

  it("applies the tier's size limit from /me/usage", async () => {
    withQuery(<UploadView />);
    await screen.findByText(/up to 3 MB/);
    const big = new File([new Uint8Array(3 * 1024 * 1024 + 10)], "cv.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByTestId("file-input"), { target: { files: [big] } });
    expect(await screen.findByTestId("upload-problem")).toHaveTextContent("larger than 3 MB");
  });

  it("uploads a valid file with its job description and opens the new resume", async () => {
    upload.mockResolvedValue({ id: "R9" });
    const user = userEvent.setup();
    withQuery(<UploadView />);
    fireEvent.change(screen.getByTestId("file-input"), { target: { files: [new File(["x"], "cv.pdf", { type: "application/pdf" })] } });
    expect(await screen.findByTestId("file-name")).toHaveTextContent("cv.pdf");
    await user.type(screen.getByLabelText(/Company/), "Acme");
    await user.type(screen.getByLabelText(/Job description/), "Build things");
    await user.click(screen.getByTestId("upload-submit"));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/resumes/R9"));
    expect(upload.mock.calls[0]![0]).toMatchObject({ company: "Acme", jd: "Build things" });
  });

  it("shows a plain message when the monthly runs are used up", async () => {
    upload.mockRejectedValue(Object.assign(new Error("x"), { code: "QUOTA_EXHAUSTED", status: 429 }));
    const user = userEvent.setup();
    withQuery(<UploadView />);
    fireEvent.change(screen.getByTestId("file-input"), { target: { files: [new File(["x"], "cv.pdf", { type: "application/pdf" })] } });
    await user.click(await screen.findByTestId("upload-submit"));
    expect(await screen.findByTestId("upload-error")).toHaveTextContent("monthly runs are used up");
  });
});

describe("document helpers", () => {
  it("knows when a document has content", () => {
    expect(hasContent({})).toBe(false);
    expect(hasContent({ personal: { fullName: " " } })).toBe(false);
    expect(hasContent({ summary: "Hello" })).toBe(true);
    expect(hasContent({ skills: [{ category: "x", items: [] }] })).toBe(true);
  });
  it("parses lists", () => {
    expect(parseCsv("a, b ,, c")).toEqual(["a", "b", "c"]);
    expect(parseLines("a\n\n b \n")).toEqual(["a", "b"]);
  });
  it("strips a sample's manifest fields", () => {
    const d = documentFromSample({ id: "x", role: "r", tags: [], personal: { fullName: "A" }, summary: "s" });
    expect(Object.keys(d)).not.toContain("id");
    expect(d.personal?.fullName).toBe("A");
  });
  it("falls back to the 13 known templates when the API gives none", () => {
    expect(templateList(undefined)).toHaveLength(13);
    expect(templateList([])[0]!.name).toBeTruthy();
  });
});

describe("SectionEditor", () => {
  it("edits personal fields, adds and removes a job, and keeps separators while typing skills", async () => {
    const user = userEvent.setup();
    let doc = { personal: { fullName: "Ada" }, skills: [{ category: "Languages", items: ["Go"] }] } as import("@open-resume/types").ResumeDocument;
    const onChange = vi.fn((d) => {
      doc = d;
    });
    const { rerender } = render(<SectionEditor doc={doc} onChange={onChange} />);
    // The editor is controlled and this test does not re-render between keys, so the last key wins.
    await user.type(screen.getByLabelText("Headline"), "Engineer");
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ personal: { fullName: "Ada", headline: "r" } }));

    await user.click(screen.getByRole("button", { name: /Add job/ }));
    expect(doc.experience).toHaveLength(1);
    rerender(<SectionEditor doc={doc} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Remove experience 1" }));
    expect(doc.experience).toHaveLength(0);

    rerender(<SectionEditor doc={doc} onChange={onChange} />);
    const skills = screen.getByLabelText("Skills, separated by commas");
    await user.type(skills, ", Rust");
    expect(doc.skills![0]!.items).toEqual(["Go", "Rust"]);
    expect((skills as HTMLInputElement).value).toBe("Go, Rust");
  });
});
