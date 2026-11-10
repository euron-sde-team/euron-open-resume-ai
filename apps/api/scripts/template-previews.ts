/**
 * Renders every template with a sample resume to apps/web/public/templates/<id>.png
 * (A4 ratio, 420 px wide) for the picker and the README.
 *
 *   pnpm --filter @open-resume/api templates:previews
 *
 * Needs a Chromium (CHROMIUM_PATH, or a system / Playwright one is found). Output is
 * deterministic for the same templates and samples, so the PNGs are committed.
 */
import fs from "node:fs";
import path from "node:path";
import { TEMPLATE_IDS, type ResumeDocument, type TemplateId } from "@open-resume/types";
import { closePdfBrowser, findChromium } from "../src/services/resume/render";
import { renderResumeHtml } from "../src/services/resume/render/html";
import { htmlToPng } from "../src/services/resume/render/pdf";
import samples from "../../../packages/samples/data/samples.json";

interface Sample extends ResumeDocument {
  id: string;
  level: string;
  suggestedTemplate: string;
}

const WIDTH = 420;
const OUT = path.resolve(__dirname, "../../web/public/templates");

/** The fullest sample that still fits one page: its own suggested template first. */
function pick(id: TemplateId): Sample {
  const all = samples as unknown as Sample[];
  const size = (s: Sample) => JSON.stringify(s).length;
  const fits = all.filter((s) => (s.experience?.length ?? 0) > 0 && size(s) < 4200);
  const own = fits.filter((s) => s.suggestedTemplate === id).sort((a, b) => size(b) - size(a));
  return own[0] ?? fits.sort((a, b) => size(b) - size(a))[(TEMPLATE_IDS.indexOf(id) * 3) % Math.max(fits.length, 1)] ?? (all[0] as Sample);
}

async function main() {
  if (!findChromium()) {
    console.error("No Chromium found. Set CHROMIUM_PATH.");
    process.exit(1);
  }
  fs.mkdirSync(OUT, { recursive: true });
  let total = 0;
  for (const id of TEMPLATE_IDS) {
    const sample = pick(id);
    const png = await htmlToPng(renderResumeHtml(sample, id), WIDTH);
    fs.writeFileSync(path.join(OUT, `${id}.png`), png);
    total += png.length;
    console.log(`${id.padEnd(36)} ${sample.id.padEnd(40)} ${(png.length / 1024).toFixed(0)} KB`);
  }
  console.log(`total ${(total / 1024).toFixed(0)} KB -> ${OUT}`);
  await closePdfBrowser();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
