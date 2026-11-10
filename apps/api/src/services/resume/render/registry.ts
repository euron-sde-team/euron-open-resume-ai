/** The 13 templates: metadata for the picker, plus the DOCX look that matches each family. */
import { DEFAULT_TEMPLATE_ID, TEMPLATE_IDS, type TemplateId, type TemplateInfo } from "@open-resume/types";

export type DocxLayout = "modern" | "classic" | "compact";

interface TemplateSpec extends Omit<TemplateInfo, "id"> {
  docx: DocxLayout;
  /** Template needs the bundled Lato and/or Merriweather faces. */
  fonts?: ("lato" | "merriweather")[];
}

export const TEMPLATE_SPECS: Record<TemplateId, TemplateSpec> = {
  resume_template: {
    name: "Classic",
    description: "A plain single-column layout with underlined sections. The safest choice for applicant tracking systems.",
    columns: 1,
    accent: "#374151",
    atsFriendly: true,
    docx: "classic",
  },
  antique_resume_template: {
    name: "Antique",
    description: "A grey sidebar for contact, skills and languages beside a clean work history.",
    columns: 2,
    accent: "#6b7280",
    atsFriendly: false,
    docx: "classic",
  },
  corporate_resume_template: {
    name: "Corporate",
    description: "Centred serif name over ruled sections. Formal and dense, suits finance and consulting.",
    columns: 1,
    accent: "#111827",
    atsFriendly: true,
    docx: "classic",
  },
  executive_resume_template: {
    name: "Executive",
    description: "Navy serif headings and a calm sans body, with a dated timeline for long careers.",
    columns: 1,
    accent: "#1f3a5f",
    atsFriendly: true,
    docx: "classic",
    fonts: ["lato", "merriweather"],
  },
  minimalist_resume_template: {
    name: "Minimalist",
    description: "A blue name over hairlines and generous whitespace, almost no decoration.",
    columns: 1,
    accent: "#1e5a96",
    atsFriendly: true,
    docx: "compact",
  },
  modern_resume_template: {
    name: "Modern",
    description: "Clean one-column page with fine gold rules and icons for contact links. The default.",
    columns: 1,
    accent: "#d9a21b",
    atsFriendly: true,
    docx: "modern",
  },
  multi_column_resume_template: {
    name: "Multi-column",
    description: "A navy sidebar for contact, skills and education beside the experience.",
    columns: 2,
    accent: "#1b2a41",
    atsFriendly: false,
    docx: "modern",
    fonts: ["lato"],
  },
  obsidian_edge_resume_template: {
    name: "Obsidian Edge",
    description: "A black header band with bold section icons. Prints best in colour.",
    columns: 1,
    accent: "#111111",
    atsFriendly: false,
    docx: "modern",
  },
  sage_multi_column_resume_template: {
    name: "Sage",
    description: "A soft sage sidebar with skills and education beside the work history.",
    columns: 2,
    accent: "#7fa38f",
    atsFriendly: false,
    docx: "modern",
  },
  simply_blue_resume_template: {
    name: "Simply Blue",
    description: "Lavender section bars under a navy name, light and airy.",
    columns: 1,
    accent: "#3b3b98",
    atsFriendly: true,
    docx: "modern",
  },
  charcoal_glow_template: {
    name: "Charcoal Glow",
    description: "A charcoal header with an amber name, then a compact single-column body.",
    columns: 1,
    accent: "#d9993b",
    atsFriendly: false,
    docx: "modern",
  },
  orangewhite_modern_template: {
    name: "Orange and White",
    description: "A bright white page with orange section headings and dates.",
    columns: 1,
    accent: "#ea580c",
    atsFriendly: true,
    docx: "modern",
  },
  entry_level_template: {
    name: "Entry level",
    description: "Pale blue section bars with education and projects up front, for students and first jobs.",
    columns: 1,
    accent: "#5b7c99",
    atsFriendly: true,
    docx: "compact",
  },
};

export function listTemplateInfo(): TemplateInfo[] {
  return TEMPLATE_IDS.map((id) => {
    const { name, description, columns, accent, atsFriendly } = TEMPLATE_SPECS[id];
    return { id, name, description, columns, accent, atsFriendly };
  });
}

export function isTemplateId(value: unknown): value is TemplateId {
  return typeof value === "string" && (TEMPLATE_IDS as readonly string[]).includes(value);
}

/**
 * Allow-list lookup: an id from the list, a "<stem>.ejs" spelling of one, or the legacy
 * short stem ("modern"). Everything else is the default template. A template id is never
 * used as a path, only as a key into this table.
 */
export function resolveTemplateId(requested: string | undefined | null): TemplateId {
  const name = (requested ?? "").trim().toLowerCase().replace(/\.ejs$/, "");
  if (isTemplateId(name)) return name;
  if (name) {
    const guess = TEMPLATE_IDS.find((id) => id === `${name}_resume_template` || id === `${name}_template`);
    if (guess) return guess;
  }
  return DEFAULT_TEMPLATE_ID;
}
