/**
 * Everything a template needs at render time, embedded in the page: FontAwesome (CSS plus
 * the woff2 files as base64, as the legacy pdf.service did) and the two Google fonts the
 * Executive and Multi-column templates use (Lato, Merriweather), taken from @fontsource.
 * No network is ever needed to render a document.
 */
import fs from "node:fs";
import path from "node:path";

function packageDir(name: string): string | null {
  const roots = [
    () => path.dirname(require.resolve(`${name}/package.json`)),
    () => path.resolve(process.cwd(), "node_modules", name),
    () => path.resolve(process.cwd(), "apps/api/node_modules", name),
    () => path.resolve(__dirname, "../node_modules", name),
    () => path.resolve(__dirname, "node_modules", name),
  ];
  for (const root of roots) {
    try {
      const dir = root();
      if (fs.existsSync(dir)) return dir;
    } catch {
      /* try the next location */
    }
  }
  return null;
}

let faStyle: string | null = null;

/** FontAwesome 6 (solid + brands) as one <style>, fonts inlined. Cached per process. */
export function fontAwesomeStyle(): string {
  if (faStyle !== null) return faStyle;
  const root = packageDir("@fortawesome/fontawesome-free");
  if (!root) return (faStyle = "");
  try {
    let css = fs.readFileSync(path.join(root, "css", "all.min.css"), "utf8");
    for (const file of ["fa-brands-400.woff2", "fa-regular-400.woff2", "fa-solid-900.woff2", "fa-v4compatibility.woff2"]) {
      const full = path.join(root, "webfonts", file);
      const token = `url(../webfonts/${file})`;
      if (!css.includes(token)) continue;
      // The regular and v4 faces are not used by any template; drop them to keep pages small.
      const used = file.includes("solid") || file.includes("brands");
      const uri = used && fs.existsSync(full) ? `data:font/woff2;base64,${fs.readFileSync(full).toString("base64")}` : "data:,";
      css = css.split(token).join(`url(${uri})`);
    }
    // Remove the .ttf fallbacks, they point at relative files that do not exist here.
    css = css.replace(/,\s*url\(\.\.\/webfonts\/[^)]+\.ttf\)\s*format\("truetype"\)/g, "");
    faStyle = `<style data-inline="fontawesome">${css}</style>`;
  } catch {
    faStyle = "";
  }
  return faStyle;
}

const fontCache = new Map<string, string>();

function face(pkg: string, family: string, file: string, weight: number, style: "normal" | "italic"): string {
  const root = packageDir(pkg);
  if (!root) return "";
  const full = path.join(root, "files", file);
  if (!fs.existsSync(full)) return "";
  const b64 = fs.readFileSync(full).toString("base64");
  return `@font-face{font-family:'${family}';font-style:${style};font-weight:${weight};font-display:block;src:url(data:font/woff2;base64,${b64}) format('woff2');}`;
}

/** @font-face rules for the bundled fonts a template asks for. */
export function fontFaceStyle(fonts: ("lato" | "merriweather")[] | undefined): string {
  if (!fonts?.length) return "";
  const key = [...fonts].sort().join(",");
  const hit = fontCache.get(key);
  if (hit !== undefined) return hit;
  const rules: string[] = [];
  if (fonts.includes("lato")) {
    for (const [w, s] of [[300, "normal"], [400, "normal"], [400, "italic"], [700, "normal"]] as const) {
      rules.push(face("@fontsource/lato", "Lato", `lato-latin-${w}-${s}.woff2`, w, s));
    }
  }
  if (fonts.includes("merriweather")) {
    for (const w of [400, 700]) rules.push(face("@fontsource/merriweather", "Merriweather", `merriweather-latin-${w}-normal.woff2`, w, "normal"));
  }
  const style = rules.some(Boolean) ? `<style data-inline="fonts">${rules.join("")}</style>` : "";
  fontCache.set(key, style);
  return style;
}
