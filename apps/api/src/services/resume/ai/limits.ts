/**
 * Size caps and the "untrusted data" wrapper. Everything a user typed or uploaded (resume
 * text, job description, company, chat messages) reaches a model only through these, so
 * the caps and the instruction hierarchy hold on every task.
 */

export const LIMITS = {
  /** Resume text handed to a model or the offline engine. */
  resumeChars: 30_000,
  jdChars: 8_000,
  companyChars: 120,
  chatMessages: 30,
  chatMessageChars: 8_000,
  /** Largest upload the import route accepts. */
  importBytes: 10 * 1024 * 1024,
} as const;

/** Trim and cap; never throws. */
export function clip(text: string | undefined | null, max: number): string {
  const t = (text ?? "").replaceAll("\u0000", "").trim();
  return t.length > max ? t.slice(0, max) : t;
}

/** One line of plain text (company names and the like). */
export function oneLine(text: string | undefined | null, max: number): string {
  return clip((text ?? "").replace(/\s+/g, " "), max);
}

/** Remove anything that could close or spoof a data block. */
function defang(text: string): string {
  return text.replace(/<\s*\/?\s*untrusted[^>]*>/gi, "[removed]");
}

/**
 * Wrap user-supplied text in a labelled block. The system prompt tells the model that
 * everything inside is data, never instructions (see DATA_RULES in prompts.ts).
 */
export function untrusted(label: string, text: string): string {
  return `<untrusted_${label}>\n${defang(text)}\n</untrusted_${label}>`;
}
