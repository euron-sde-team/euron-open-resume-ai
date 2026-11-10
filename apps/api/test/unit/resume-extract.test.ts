import { describe, expect, test } from "vitest";
import { collapseWhitespace, extractText, ExtractError, MAX_TEXT_CHARS, sniffFile } from "../../src/services/resume/extract";

/** A minimal one-page PDF with a text line, hand-built (the xref is rebuilt by pdf.js). */
function tinyPdf(text: string): Buffer {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, "latin1");
}

/** A zip with stored (uncompressed, unchecked) entries, enough for sniffing. */
function fakeZip(names: string[], size = 10): Buffer {
  const locals: Buffer[] = [];
  const cds: Buffer[] = [];
  let offset = 0;
  for (const n of names) {
    const name = Buffer.from(n);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    const cd = Buffer.alloc(46 + name.length);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt32LE(size, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE(offset, 42);
    name.copy(cd, 46);
    locals.push(local);
    cds.push(cd);
    offset += local.length;
  }
  const cdBuf = Buffer.concat(cds);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(names.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cdBuf, eocd]);
}

describe("sniffFile", () => {
  test("decides from the bytes, not the name", () => {
    expect(sniffFile(tinyPdf("hello"), "x.txt")?.ext).toBe("pdf");
    expect(sniffFile(fakeZip(["[Content_Types].xml", "word/document.xml"]), "x.pdf")?.ext).toBe("docx");
    expect(sniffFile(fakeZip(["a.txt"]), "x.docx")).toBeNull();
    expect(sniffFile(Buffer.from("plain words"), "cv.txt")?.ext).toBe("txt");
    expect(sniffFile(Buffer.from("# Title"), "cv.md")?.ext).toBe("md");
  });
  test("refuses binaries, unknown extensions and empty files", () => {
    expect(sniffFile(Buffer.from([0x4d, 0x5a, 0x90, 0, 3, 0]), "cv.txt")).toBeNull();
    expect(sniffFile(Buffer.from("text"), "cv.exe")).toBeNull();
    expect(sniffFile(Buffer.alloc(0), "cv.txt")).toBeNull();
    expect(sniffFile(Buffer.from([0xff, 0xfe, 0xfd, 0xc3]), "cv.txt")).toBeNull();
  });
});

describe("extractText", () => {
  const long = "Experienced engineer with a long record of building reliable systems. ".repeat(3);
  test("plain text is whitespace-collapsed", async () => {
    const kind = sniffFile(Buffer.from("x"), "a.txt")!;
    const text = await extractText(Buffer.from(`Line one   with   gaps\r\n\r\n\r\n\r\n\tLine two\u00a0here. ${long}`), kind);
    expect(text).toContain("Line one with gaps\n\nLine two here.");
    expect(text).not.toMatch(/ {2}|\n{3}/);
  });
  test("caps at 31,000 characters", async () => {
    const text = await extractText(Buffer.from("word ".repeat(20_000)), { ext: "txt", mime: "text/plain" });
    expect(text.length).toBe(MAX_TEXT_CHARS);
  });
  test("a scan with almost no text is refused with a clear error", async () => {
    await expect(extractText(Buffer.from("  \n 12 \n"), { ext: "txt", mime: "text/plain" })).rejects.toMatchObject({ code: "NO_TEXT" });
    await expect(extractText(tinyPdf("tiny"), { ext: "pdf", mime: "application/pdf" })).rejects.toBeInstanceOf(ExtractError);
  });
  test("reads the text of a PDF", async () => {
    const text = await extractText(tinyPdf("Senior engineer with ten years of experience building distributed systems"), { ext: "pdf", mime: "application/pdf" });
    expect(text).toContain("distributed systems");
  });
  test("a corrupt PDF is an unreadable-file error, not a crash", async () => {
    await expect(extractText(Buffer.from("%PDF-1.4 garbage"), { ext: "pdf", mime: "application/pdf" })).rejects.toMatchObject({ code: "UNREADABLE_FILE" });
  });
  test("a decompression-bomb DOCX is refused before it is opened", async () => {
    await expect(extractText(fakeZip(["word/document.xml"], 200 * 1024 * 1024), { ext: "docx", mime: "x" })).rejects.toMatchObject({ code: "UNREADABLE_FILE" });
  });
  test("collapseWhitespace strips control characters", () => {
    expect(collapseWhitespace("a\u0000b\u0007c")).toBe("a b c");
  });
});
