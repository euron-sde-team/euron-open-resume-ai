/**
 * Resume and cover letter .docx builder (the `docx` library, no template engine).
 *
 * Table-driven, like a printed resume: a header table (identity left, links right), one
 * block per section, and a borderless table per experience / project / education entry so
 * the role, company and dates stay aligned when bullets wrap. It opens the same in
 * Microsoft Word, LibreOffice and Google Docs. Three layouts (modern, classic, compact)
 * and one accent colour per template family (see registry.ts).
 *
 * Schema-tolerant: missing fields are skipped, every string is trimmed, links are filtered
 * to http, https, mailto and tel, and the photo must be a png/jpeg/gif whose bytes agree
 * with its declared type.
 */
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  convertInchesToTwip,
  type IBorderOptions,
} from "docx";
import type { CoverLetter, ResumeDocument, TemplateId } from "@open-resume/types";
import { TEMPLATE_SPECS, type DocxLayout } from "./registry";
import { cleanUrl, safeDataImage } from "./safe";

type ResumeTemplate = DocxLayout;
type ResumeData = ResumeDocument;

// ── Style tokens ───────────────────────────────────────────────────────────

const COLORS = {
  text: "1F2937", // gray-800 ish
  textSoft: "4B5563", // gray-600
  textMuted: "6B7280", // gray-500
  accent: "2563EB", // replaced per template at build time (registry accent)
  accentSoft: "EEF1FF",
  rule: "E5E7EB",
};
const FONT = "Calibri"; // most installed default; renders consistently everywhere

// Reusable invisible border block - borderless tables are how we align
// "title - company - dates" horizontally without showing visible cells.
const NO_BORDER: IBorderOptions = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const NO_BORDERS = { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER, insideHorizontal: NO_BORDER, insideVertical: NO_BORDER };

function clean(s: string | undefined | null): string {
  return (s ?? "").toString().trim();
}
function nonEmpty(arr: unknown[] | undefined): boolean {
  return Array.isArray(arr) && arr.length > 0;
}

/**
 * Decode a photo data URL into bytes docx can embed. Only png, jpeg and gif data URLs are
 * accepted and the magic bytes must agree with the declared type; anything else returns
 * null so the photo is skipped without failing the render.
 */
export function decodePhoto(input: string | undefined): { buffer: Buffer; type: "png" | "jpg" | "gif" } | null {
  const url = safeDataImage(input);
  if (!url) return null;
  const comma = url.indexOf(",");
  const declared = /^data:image\/(png|jpeg|gif);/.exec(url)?.[1];
  const buffer = Buffer.from(url.slice(comma + 1), "base64");
  if (buffer.length < 64) return null;
  let sniffed: "png" | "jpg" | "gif" | null = null;
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) sniffed = "png";
  else if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) sniffed = "jpg";
  else if (buffer.subarray(0, 4).toString("latin1") === "GIF8") sniffed = "gif";
  if (!sniffed) return null;
  const want = declared === "jpeg" ? "jpg" : declared;
  return sniffed === want ? { buffer, type: sniffed } : null;
}

// ── Atomic helpers ─────────────────────────────────────────────────────────

function text(value: string, opts: { bold?: boolean; italic?: boolean; size?: number; color?: string } = {}): TextRun {
  return new TextRun({
    text: value,
    bold: opts.bold,
    italics: opts.italic,
    size: opts.size ?? 22, // 11pt; docx sizes are half-points
    color: opts.color ?? COLORS.text,
    font: FONT,
  });
}

function link(label: string, url: string, color: string = COLORS.accent): ExternalHyperlink | TextRun {
  const href = cleanUrl(url);
  if (!href) return new TextRun({ text: label, color: COLORS.textSoft, size: 20, font: FONT });
  return new ExternalHyperlink({
    link: href,
    children: [new TextRun({ text: label, color, size: 20, font: FONT, underline: {} })],
  });
}

function sectionHeading(label: string, template: ResumeTemplate = "modern"): Paragraph {
  // The three templates differ mostly in their section-heading treatment.
  // Modern: accent underline, all-caps, accent colour.
  // Classic: centred small-caps in plain text, thin black rule under.
  // Compact: tight all-caps in muted gray, no rule, smaller font for density.
  if (template === "classic") {
    return new Paragraph({
      heading: HeadingLevel.HEADING_2,
      alignment: AlignmentType.CENTER,
      spacing: { before: 180, after: 60 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: COLORS.text } },
      children: [
        new TextRun({
          text: label.toUpperCase(),
          bold: true,
          size: 22,
          color: COLORS.text,
          font: FONT,
          characterSpacing: 40,
        }),
      ],
    });
  }
  if (template === "compact") {
    return new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 140, after: 30 },
      children: [
        new TextRun({
          text: label.toUpperCase(),
          bold: true,
          size: 18,
          color: COLORS.textMuted,
          font: FONT,
          characterSpacing: 30,
        }),
      ],
    });
  }
  // modern (default)
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 220, after: 80 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: COLORS.accent } },
    children: [
      new TextRun({
        text: label.toUpperCase(),
        bold: true,
        size: 22,
        color: COLORS.accent,
        font: FONT,
        characterSpacing: 20,
      }),
    ],
  });
}

function bulletPara(content: string): Paragraph {
  return new Paragraph({
    bullet: { level: 0 },
    spacing: { before: 0, after: 30 },
    children: [text(content)],
  });
}

// ── Header (name + contact + links) ─────────────────────────────────────────

function photoCell(photoDataUrl: string | undefined): TableCell | null {
  const decoded = decodePhoto(photoDataUrl);
  if (!decoded) return null;
  return new TableCell({
    width: { size: 18, type: WidthType.PERCENTAGE },
    borders: NO_BORDERS,
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 0 },
        children: [
          new ImageRun({
            data: decoded.buffer,
            type: decoded.type,
            transformation: { width: 90, height: 90 },
          }),
        ],
      }),
    ],
  });
}

function headerTable(personal: ResumeData["personal"], links: ResumeData["links"]): Table {
  const name = clean(personal?.fullName) || "Your Name";
  const headline = clean(personal?.headline);
  const contactBits = [
    clean(personal?.location),
    clean(personal?.email),
    clean(personal?.phone),
  ].filter(Boolean);

  const leftCellChildren: Paragraph[] = [
    new Paragraph({
      spacing: { after: 60 },
      children: [
        new TextRun({ text: name, bold: true, size: 44, color: COLORS.text, font: FONT }),
      ],
    }),
  ];
  if (headline) {
    leftCellChildren.push(
      new Paragraph({
        spacing: { after: 80 },
        children: [new TextRun({ text: headline, size: 24, color: COLORS.accent, font: FONT })],
      }),
    );
  }
  if (contactBits.length > 0) {
    leftCellChildren.push(
      new Paragraph({
        spacing: { after: 40 },
        children: [
          new TextRun({
            text: contactBits.join("  ·  "),
            size: 20,
            color: COLORS.textSoft,
            font: FONT,
          }),
        ],
      }),
    );
  }

  // Right column - clickable links
  const linkParas: Paragraph[] = [];
  const pushLink = (label: string, url: string | undefined) => {
    const u = cleanUrl(url) ?? "";
    if (!u) return;
    linkParas.push(
      new Paragraph({
        spacing: { after: 30 },
        alignment: AlignmentType.RIGHT,
        children: [
          new TextRun({ text: `${label}  `, size: 18, color: COLORS.textMuted, font: FONT }),
          link(u.replace(/^https?:\/\//, ""), u),
        ],
      }),
    );
  };
  pushLink("Portfolio", links?.portfolio);
  pushLink("GitHub", links?.github);
  pushLink("LinkedIn", links?.linkedin);
  pushLink("YouTube", links?.youtube);
  pushLink("Twitter", links?.twitter);
  (links?.other ?? []).forEach((l) => pushLink(clean(l.label) || "Link", l.url));
  if (linkParas.length === 0) {
    // Reserve cell space so the layout doesn't collapse to one column
    linkParas.push(new Paragraph({ children: [new TextRun({ text: " " })] }));
  }

  const photo = photoCell(personal?.photoDataUrl);
  // 3-column layout (photo | identity | links) when a photo is present,
  // 2-column layout (identity | links) otherwise. Either way the right column
  // holds the clickable hyperlinks.
  const cells: TableCell[] = [];
  if (photo) cells.push(photo);
  cells.push(
    new TableCell({
      width: { size: photo ? 47 : 65, type: WidthType.PERCENTAGE },
      borders: NO_BORDERS,
      children: leftCellChildren,
    }),
  );
  cells.push(
    new TableCell({
      width: { size: 35, type: WidthType.PERCENTAGE },
      borders: NO_BORDERS,
      children: linkParas,
    }),
  );

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: NO_BORDERS,
    rows: [new TableRow({ children: cells })],
  });
}

/**
 * Centred header for the "classic" template - name, headline, contact line,
 * then links on a single row below. Photo (if any) sits above the name.
 */
function classicHeader(personal: ResumeData["personal"], links: ResumeData["links"]): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  const decoded = decodePhoto(personal?.photoDataUrl);
  if (decoded) {
    out.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 80 },
        children: [
          new ImageRun({
            data: decoded.buffer,
            type: decoded.type,
            transformation: { width: 100, height: 100 },
          }),
        ],
      }),
    );
  }
  out.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 40 },
      children: [
        new TextRun({
          text: clean(personal?.fullName) || "Your Name",
          bold: true,
          size: 48,
          color: COLORS.text,
          font: FONT,
          characterSpacing: 30,
        }),
      ],
    }),
  );
  if (clean(personal?.headline)) {
    out.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 80 },
        children: [
          new TextRun({ text: clean(personal!.headline!), size: 22, italics: true, color: COLORS.textSoft, font: FONT }),
        ],
      }),
    );
  }
  const contact = [clean(personal?.location), clean(personal?.email), clean(personal?.phone)].filter(Boolean);
  if (contact.length > 0) {
    out.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 60 },
        children: [
          new TextRun({ text: contact.join("  ·  "), size: 20, color: COLORS.textSoft, font: FONT }),
        ],
      }),
    );
  }
  // Links - single centred row with clickable hyperlinks
  const linkRuns: (TextRun | ExternalHyperlink)[] = [];
  const pushLink = (label: string, url?: string) => {
    const u = cleanUrl(url) ?? "";
    if (!u) return;
    if (linkRuns.length > 0) {
      linkRuns.push(new TextRun({ text: "  ·  ", size: 20, color: COLORS.textMuted, font: FONT }));
    }
    linkRuns.push(new TextRun({ text: `${label}: `, size: 20, color: COLORS.textMuted, font: FONT }));
    linkRuns.push(link(u.replace(/^https?:\/\//, ""), u));
  };
  pushLink("Portfolio", links?.portfolio);
  pushLink("GitHub", links?.github);
  pushLink("LinkedIn", links?.linkedin);
  pushLink("YouTube", links?.youtube);
  pushLink("Twitter", links?.twitter);
  (links?.other ?? []).forEach((l) => pushLink(clean(l.label) || "Link", l.url));
  if (linkRuns.length > 0) {
    out.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 40 },
        children: linkRuns,
      }),
    );
  }
  return out;
}

// ── Section: experience-like (also used for projects, education) ───────────

function experienceEntryTable(opts: {
  primary: string; // job title / project name / degree
  secondary?: string; // company / institution
  side?: string; // location / dates
  dates?: string;
  link?: string; // optional clickable URL for projects
}): Table {
  const left = [
    new Paragraph({
      spacing: { after: 20 },
      children: [
        new TextRun({ text: clean(opts.primary), bold: true, size: 22, color: COLORS.text, font: FONT }),
      ],
    }),
  ];
  const safeLink = cleanUrl(opts.link) ?? "";
  if (clean(opts.secondary) || safeLink) {
    const runs: (TextRun | ExternalHyperlink)[] = [];
    if (clean(opts.secondary)) {
      runs.push(new TextRun({ text: clean(opts.secondary), italics: true, size: 20, color: COLORS.textSoft, font: FONT }));
    }
    if (safeLink) {
      if (runs.length > 0) runs.push(new TextRun({ text: "  ·  ", size: 20, color: COLORS.textMuted, font: FONT }));
      runs.push(link(safeLink, safeLink, COLORS.accent));
    }
    left.push(new Paragraph({ spacing: { after: 40 }, children: runs }));
  }
  const rightLine = [clean(opts.dates), clean(opts.side)].filter(Boolean).join("  ·  ");
  const right = rightLine
    ? [
        new Paragraph({
          alignment: AlignmentType.RIGHT,
          spacing: { after: 0 },
          children: [
            new TextRun({ text: rightLine, size: 20, color: COLORS.textMuted, font: FONT }),
          ],
        }),
      ]
    : [new Paragraph({ children: [new TextRun({ text: " " })] })];

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: NO_BORDERS,
    rows: [
      new TableRow({
        children: [
          new TableCell({ width: { size: 70, type: WidthType.PERCENTAGE }, borders: NO_BORDERS, children: left }),
          new TableCell({ width: { size: 30, type: WidthType.PERCENTAGE }, borders: NO_BORDERS, children: right }),
        ],
      }),
    ],
  });
}

// ── Section: skills (tag pills built from shaded table cells) ──────────────

function skillsBlock(skills: { category?: string; items?: string[] }[]): Paragraph[] {
  const out: Paragraph[] = [];
  for (const group of skills) {
    const items = (group.items || []).map((s) => clean(s)).filter(Boolean);
    if (items.length === 0) continue;
    out.push(
      new Paragraph({
        spacing: { before: 80, after: 40 },
        children: [
          ...(clean(group.category)
            ? [
                new TextRun({
                  text: `${clean(group.category)}:  `,
                  bold: true,
                  size: 20,
                  color: COLORS.text,
                  font: FONT,
                }),
              ]
            : []),
          new TextRun({ text: items.join(" · "), size: 20, color: COLORS.textSoft, font: FONT }),
        ],
      }),
    );
  }
  return out;
}

// ── Top-level builder ──────────────────────────────────────────────────────

export async function buildResumeDocx(data: ResumeData, templateId: TemplateId): Promise<Buffer> {
  const spec = TEMPLATE_SPECS[templateId];
  const template: ResumeTemplate = spec.docx;
  COLORS.accent = spec.accent.replace("#", "").toUpperCase();
  const blocks: (Paragraph | Table)[] = [];

  // Header - classic uses a centred stack with photo above the name; modern
  // and compact share the two-column header with photo + name + links.
  if (template === "classic") {
    blocks.push(...classicHeader(data.personal, data.links));
  } else {
    blocks.push(headerTable(data.personal, data.links));
  }

  // Summary
  if (clean(data.summary)) {
    blocks.push(sectionHeading("Summary", template));
    blocks.push(
      new Paragraph({
        spacing: { after: 80 },
        children: [text(clean(data.summary), { color: COLORS.textSoft })],
      }),
    );
  }

  // Experience
  if (nonEmpty(data.experience)) {
    blocks.push(sectionHeading("Experience", template));
    for (const job of data.experience!) {
      blocks.push(
        experienceEntryTable({
          primary: clean(job.title) || "Role",
          secondary: clean(job.company),
          side: clean(job.location),
          dates: [clean(job.start), clean(job.end)].filter(Boolean).join(" - "),
        }),
      );
      if (clean(job.description)) {
        blocks.push(
          new Paragraph({
            spacing: { before: 20, after: 40 },
            children: [text(clean(job.description), { color: COLORS.textSoft })],
          }),
        );
      }
      for (const b of job.bullets || []) {
        if (clean(b)) blocks.push(bulletPara(clean(b)));
      }
      blocks.push(new Paragraph({ spacing: { before: 0, after: 60 }, children: [new TextRun({ text: " " })] }));
    }
  }

  // Projects
  if (nonEmpty(data.projects)) {
    blocks.push(sectionHeading("Projects", template));
    for (const proj of data.projects!) {
      blocks.push(
        experienceEntryTable({
          primary: clean(proj.name) || "Project",
          secondary: nonEmpty(proj.tech) ? (proj.tech || []).filter(Boolean).join(", ") : "",
          dates: "",
          link: clean(proj.link),
        }),
      );
      if (clean(proj.description)) {
        blocks.push(
          new Paragraph({
            spacing: { before: 20, after: 40 },
            children: [text(clean(proj.description), { color: COLORS.textSoft })],
          }),
        );
      }
      for (const b of proj.bullets || []) {
        if (clean(b)) blocks.push(bulletPara(clean(b)));
      }
      blocks.push(new Paragraph({ spacing: { before: 0, after: 60 }, children: [new TextRun({ text: " " })] }));
    }
  }

  // Education
  if (nonEmpty(data.education)) {
    blocks.push(sectionHeading("Education", template));
    for (const edu of data.education!) {
      blocks.push(
        experienceEntryTable({
          primary: clean(edu.degree) || "Degree",
          secondary: clean(edu.institution),
          side: clean(edu.location),
          dates: [clean(edu.start), clean(edu.end)].filter(Boolean).join(" - "),
        }),
      );
      const tail = [clean(edu.score), clean(edu.details)].filter(Boolean).join(" · ");
      if (tail) {
        blocks.push(
          new Paragraph({
            spacing: { before: 20, after: 60 },
            children: [text(tail, { color: COLORS.textSoft })],
          }),
        );
      }
    }
  }

  // Skills
  if (nonEmpty(data.skills)) {
    blocks.push(sectionHeading("Skills", template));
    blocks.push(...skillsBlock(data.skills!));
  }

  // Certifications
  if (nonEmpty(data.certifications)) {
    blocks.push(sectionHeading("Certifications", template));
    for (const c of data.certifications!) {
      const main = [clean(c.name), clean(c.issuer)].filter(Boolean).join(" - ");
      const sideBits = [clean(c.date)].filter(Boolean).join("");
      blocks.push(
        new Paragraph({
          spacing: { before: 10, after: 40 },
          children: [
            new TextRun({ text: main, size: 20, color: COLORS.text, font: FONT, bold: true }),
            ...(sideBits ? [new TextRun({ text: `  ·  ${sideBits}`, size: 18, color: COLORS.textMuted, font: FONT })] : []),
            ...(cleanUrl(c.link) ? [new TextRun({ text: "  ·  ", size: 18, color: COLORS.textMuted, font: FONT }), link(cleanUrl(c.link) as string, cleanUrl(c.link) as string)] : []),
          ],
        }),
      );
    }
  }

  // Languages
  if (nonEmpty(data.languages)) {
    blocks.push(sectionHeading("Languages", template));
    const pairs = (data.languages || [])
      .map((l) => `${clean(l.name)}${clean(l.level) ? ` (${clean(l.level)})` : ""}`.trim())
      .filter(Boolean);
    blocks.push(
      new Paragraph({
        spacing: { before: 10, after: 40 },
        children: [new TextRun({ text: pairs.join("  ·  "), size: 20, color: COLORS.textSoft, font: FONT })],
      }),
    );
  }

  // Achievements
  if (nonEmpty(data.achievements)) {
    blocks.push(sectionHeading("Achievements", template));
    for (const a of data.achievements!) {
      if (clean(a)) blocks.push(bulletPara(clean(a)));
    }
  }

  // Explicitly force the page background to white via the Document-level
  // `background` option (writes <w:background w:color="FFFFFF"/> into the XML).
  // The previous version of this code was passing a bogus themeColor that
  // some Word builds (notably the "Product Activation Failed" mode) parsed
  // as "no background" and fell back to a system colour - which in Windows
  // high-contrast / dark themes rendered as solid black. Forcing the colour
  // here AND on every text run defends against both. We also set the same
  // white shading via `displayBackgroundShape: true` so Word's "Display
  // background colors" view setting doesn't suppress it.
  const doc = new Document({
    title: clean(data.personal?.fullName) || "Resume",
    background: { color: "FFFFFF" },
    styles: {
      default: {
        document: {
          run: { font: FONT, size: 22, color: COLORS.text },
          paragraph: { spacing: { line: 300 } },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(0.6),
              bottom: convertInchesToTwip(0.6),
              left: convertInchesToTwip(0.6),
              right: convertInchesToTwip(0.6),
            },
          },
        },
        children: blocks,
      },
    ],
  });

  // Packer returns a Buffer in node - perfect for streaming to res.send().
  return Packer.toBuffer(doc);
}

// ── Cover letter ───────────────────────────────────────────────────────────

export async function buildCoverLetterDocx(letter: CoverLetter, author: ResumeDocument): Promise<Buffer> {
  const h = letter.header ?? {};
  const p = author.personal ?? {};
  const name = clean(h.name) || clean(p.fullName) || "Applicant";
  const contact = [clean(h.location) || clean(p.location), clean(h.email) || clean(p.email), clean(h.phone) || clean(p.phone)].filter(Boolean);
  const para = (value: string, after = 160) =>
    new Paragraph({ spacing: { after }, children: [text(value, { size: 22 })] });

  const blocks: Paragraph[] = [
    new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: name, bold: true, size: 40, color: COLORS.text, font: FONT })] }),
  ];
  if (clean(p.headline)) blocks.push(new Paragraph({ spacing: { after: 40 }, children: [text(clean(p.headline), { color: COLORS.textSoft })] }));
  if (contact.length) blocks.push(new Paragraph({ spacing: { after: 240 }, children: [text(contact.join("  ·  "), { size: 20, color: COLORS.textSoft })] }));
  blocks.push(para(clean(h.date) || new Date().toISOString().slice(0, 10), 200));
  for (const line of [clean(h.recipient), clean(h.company)].filter(Boolean)) blocks.push(para(line, 20));
  blocks.push(para(clean(letter.greeting) || "Dear Hiring Manager,", 160));
  for (const paragraph of letter.paragraphs ?? []) {
    if (clean(paragraph)) blocks.push(para(clean(paragraph)));
  }
  blocks.push(para(`${clean(letter.closing).replace(/[,\s]+$/, "") || "Sincerely"},`, 60));
  blocks.push(new Paragraph({ children: [new TextRun({ text: name, bold: true, size: 22, color: COLORS.text, font: FONT })] }));

  const doc = new Document({
    title: `${name} cover letter`,
    background: { color: "FFFFFF" },
    styles: { default: { document: { run: { font: FONT, size: 22, color: COLORS.text }, paragraph: { spacing: { line: 300 } } } } },
    sections: [
      {
        properties: {
          page: { margin: { top: convertInchesToTwip(1), bottom: convertInchesToTwip(1), left: convertInchesToTwip(1), right: convertInchesToTwip(1) } },
        },
        children: blocks,
      },
    ],
  });
  return Packer.toBuffer(doc);
}
