/**
 * PDF engine: one long-lived Chromium (puppeteer-core, no bundled browser), locked down.
 *
 *  - Sandbox ON unless CHROMIUM_NO_SANDBOX=1 (containers that cannot grant the
 *    capabilities Chromium's sandbox needs).
 *  - JavaScript off, every request except data: and about: aborted, so a hostile `<img>`
 *    or `@import` in resume data cannot reach the network or the host.
 *  - Fixed A4, bounded time per page, a small concurrency limiter with a bounded queue,
 *    and the browser is recycled after N pages (Chromium leaks) instead of per call.
 *
 * The Chromium binary comes from CHROMIUM_PATH, else the first existing of the usual
 * system locations and (local development) the Playwright cache.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import puppeteer, { type Browser } from "puppeteer-core";
import { config } from "../../../core/config";
import { captureError } from "../../../core/logger";

export class PdfUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfUnavailableError";
  }
}

const SYSTEM_PATHS = [
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/snap/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];

function playwrightCandidates(): string[] {
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, path.join(os.homedir(), "Library/Caches/ms-playwright"), path.join(os.homedir(), ".cache/ms-playwright")].filter(
    (r): r is string => !!r,
  );
  const out: string[] = [];
  for (const root of roots) {
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(root);
    } catch {
      continue;
    }
    // Newest build first; the full Chromium before the headless shell.
    const newestFirst = (a: string, b: string) => Number(b.split("-").pop()) - Number(a.split("-").pop());
    const builds = entries.filter((e) => /^chromium-\d+$/.test(e)).sort(newestFirst);
    const shells = entries.filter((e) => /^chromium_headless_shell-\d+$/.test(e)).sort(newestFirst);
    for (const b of builds) {
      out.push(
        path.join(root, b, "chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium"),
        path.join(root, b, "chrome-mac/Chromium.app/Contents/MacOS/Chromium"),
        path.join(root, b, "chrome-linux/chrome"),
        path.join(root, b, "chrome-linux64/chrome"),
      );
    }
    for (const s of shells) {
      out.push(
        path.join(root, s, "chrome-headless-shell-mac-arm64/chrome-headless-shell"),
        path.join(root, s, "chrome-headless-shell-mac-x64/chrome-headless-shell"),
        path.join(root, s, "chrome-linux/headless_shell"),
        path.join(root, s, "chrome-headless-shell-linux64/chrome-headless-shell"),
      );
    }
  }
  return out;
}

/** The Chromium to use, or null when none is installed. */
export function findChromium(): string | null {
  const explicit = config.CHROMIUM_PATH?.trim();
  if (explicit) return fs.existsSync(explicit) ? explicit : null;
  for (const p of [...SYSTEM_PATHS, ...playwrightCandidates()]) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const A4_MM = { width: "210mm", height: "297mm" } as const;
const NAV_TIMEOUT_MS = 20_000;
const MAX_QUEUE = 25;

let browser: Promise<Browser> | null = null;
let pagesServed = 0;
let active = 0;
const waiting: (() => void)[] = [];
let exitHook = false;

async function launch(): Promise<Browser> {
  const executablePath = findChromium();
  if (!executablePath) {
    throw new PdfUnavailableError("No Chromium found. Install one and set CHROMIUM_PATH (see docs/guides/configuration.md).");
  }
  const args = [
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-sync",
    "--disable-translate",
    "--disable-component-update",
    "--mute-audio",
    "--hide-scrollbars",
    "--font-render-hinting=none",
    "--disable-features=Translate,MediaRouter,OptimizationHints",
  ];
  if (config.CHROMIUM_NO_SANDBOX === "1") args.push("--no-sandbox", "--disable-setuid-sandbox");
  let b: Browser;
  try {
    b = await puppeteer.launch({ executablePath, headless: true, args, handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false });
  } catch (err) {
    // A Chromium that is installed but will not start (no sandbox permission, missing libraries) is
    // the same operator problem as no Chromium: say so, as a 503, with the cause in the log.
    captureError(err, { where: "pdf.launch" });
    throw new PdfUnavailableError("Chromium failed to start. See the log, and CHROMIUM_NO_SANDBOX in docs/guides/configuration.md.");
  }
  b.on("disconnected", () => {
    // Only forget it when it is still the current browser (a recycled one is already replaced).
    void browser?.then((cur) => {
      if (cur === b) browser = null;
    });
  });
  if (!exitHook) {
    exitHook = true;
    process.once("exit", () => {
      void browser?.then((x) => x.process()?.kill("SIGKILL")).catch(() => undefined);
    });
  }
  return b;
}

async function getBrowser(): Promise<Browser> {
  if (browser) {
    const b = await browser.catch(() => null);
    if (b?.connected) return b;
    browser = null;
  }
  pagesServed = 0;
  browser = launch();
  browser.catch(() => {
    browser = null;
  });
  return browser;
}

/** Close the shared browser (graceful shutdown, tests). The next render launches a new one. */
export async function closePdfBrowser(): Promise<void> {
  const current = browser;
  browser = null;
  if (!current) return;
  try {
    await (await current).close();
  } catch {
    /* already gone */
  }
}

async function acquire(): Promise<void> {
  if (active < config.PDF_CONCURRENCY) {
    active += 1;
    return;
  }
  if (waiting.length >= MAX_QUEUE) throw new PdfUnavailableError("The PDF engine is busy, try again shortly.");
  await new Promise<void>((resolve) => waiting.push(resolve));
}

function release(): void {
  const next = waiting.shift();
  if (next) next();
  else active -= 1;
}

/** HTML in, PDF out. `html` must already be a complete, self-contained document. */
export async function htmlToPdf(html: string): Promise<Buffer> {
  await acquire();
  try {
    const b = await getBrowser();
    const page = await b.newPage();
    try {
      page.setDefaultTimeout(NAV_TIMEOUT_MS);
      page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);
      await page.setJavaScriptEnabled(false);
      await page.setRequestInterception(true);
      page.on("request", (req) => {
        const url = req.url();
        if (url.startsWith("data:") || url.startsWith("about:")) void req.continue().catch(() => undefined);
        else void req.abort("blockedbyclient").catch(() => undefined);
      });
      await page.setContent(html, { waitUntil: "load", timeout: NAV_TIMEOUT_MS });
      const pdf = await page.pdf({
        width: A4_MM.width,
        height: A4_MM.height,
        printBackground: true,
        preferCSSPageSize: true,
        timeout: 30_000,
      });
      return Buffer.from(pdf);
    } finally {
      await page.close().catch(() => undefined);
    }
  } finally {
    pagesServed += 1;
    const recycle = pagesServed >= config.PDF_RECYCLE_PAGES;
    release();
    if (recycle && active === 0) void closePdfBrowser();
  }
}

/** A PNG of the first page, for the template previews script. Same lockdown as the PDF. */
export async function htmlToPng(html: string, width: number): Promise<Buffer> {
  await acquire();
  try {
    const b = await getBrowser();
    const page = await b.newPage();
    try {
      await page.setJavaScriptEnabled(false);
      await page.setRequestInterception(true);
      page.on("request", (req) => {
        const url = req.url();
        if (url.startsWith("data:") || url.startsWith("about:")) void req.continue().catch(() => undefined);
        else void req.abort("blockedbyclient").catch(() => undefined);
      });
      const height = Math.round((794 * 297) / 210);
      await page.setViewport({ width: 794, height, deviceScaleFactor: width / 794 });
      await page.emulateMediaType("print");
      await page.setContent(html, { waitUntil: "load", timeout: NAV_TIMEOUT_MS });
      const shot = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: 794, height } });
      return Buffer.from(shot);
    } finally {
      await page.close().catch(() => undefined);
    }
  } finally {
    release();
  }
}
