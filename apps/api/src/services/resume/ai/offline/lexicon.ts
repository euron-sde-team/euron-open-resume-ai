/** Word lists and small text helpers shared by the offline engine. */

export const ACTION_VERBS = new Set(
  `accelerated accomplished achieved acquired adapted administered advised aligned analyzed analysed announced applied appointed architected assembled assessed assisted audited authored automated balanced benchmarked boosted briefed budgeted built calculated captured catalogued chaired championed clarified coached collaborated compiled completed composed conceived conducted configured consolidated constructed consulted continued contributed controlled converted coordinated created curated customized debugged decreased delegated delivered demonstrated deployed derived designed detected determined developed devised diagnosed directed discovered documented doubled drafted drove earned edited educated eliminated enabled engineered enhanced ensured established estimated evaluated examined exceeded executed expanded expedited explored extended facilitated finalized fixed forecasted formalized formulated founded generated governed guided handled headed helped identified implemented improved increased influenced informed initiated innovated inspected installed instituted integrated introduced invented investigated launched led leveraged lifted maintained managed mapped marketed mastered maximized measured mediated mentored merged migrated minimized mobilized modeled modernized monitored motivated negotiated normalized observed obtained onboarded operated optimized orchestrated organized outperformed overhauled oversaw owned partnered performed pioneered planned positioned prepared presented prioritized processed procured produced programmed promoted proposed prototyped provided published queried raised ranked rebuilt received recommended reconciled recruited redesigned reduced refactored refined reengineered regulated rehabilitated released remodeled renegotiated reorganized replaced reported represented researched resolved restructured retained retrieved reviewed revised revitalized saved scaled scheduled screened secured selected served shaped shipped simplified sold solved sourced spearheaded specified sped standardized started streamlined strengthened structured studied submitted supervised supported surpassed synthesized tailored taught team-led tested tracked trained transformed translated tripled troubleshot trimmed uncovered unified updated upgraded used validated verified visualized widened won wrote`.split(/\s+/),
);

/** Past tense of gerunds the improver meets after "responsible for", "worked on". */
export const GERUND_TO_PAST: Record<string, string> = {
  managing: "Managed", leading: "Led", building: "Built", developing: "Developed", designing: "Designed", creating: "Created", maintaining: "Maintained", implementing: "Implemented", writing: "Wrote", running: "Ran", testing: "Tested", deploying: "Deployed", coordinating: "Coordinated", supporting: "Supported", handling: "Handled", analyzing: "Analyzed", analysing: "Analysed", monitoring: "Monitored", planning: "Planned", training: "Trained", mentoring: "Mentored", reviewing: "Reviewed", improving: "Improved", optimizing: "Optimized", optimising: "Optimised", migrating: "Migrated", automating: "Automated", delivering: "Delivered", ensuring: "Ensured", organizing: "Organized", organising: "Organised", preparing: "Prepared", processing: "Processed", producing: "Produced", reporting: "Reported", resolving: "Resolved", scheduling: "Scheduled", selling: "Sold", serving: "Served", supervising: "Supervised", updating: "Updated", driving: "Drove", overseeing: "Oversaw", owning: "Owned", launching: "Launched", researching: "Researched", recruiting: "Recruited", negotiating: "Negotiated", presenting: "Presented", troubleshooting: "Troubleshot", configuring: "Configured", integrating: "Integrated", documenting: "Documented", executing: "Executed", establishing: "Established", administering: "Administered", operating: "Operated", conducting: "Conducted", evaluating: "Evaluated", tracking: "Tracked", providing: "Provided", performing: "Performed", gathering: "Gathered", translating: "Translated", cleaning: "Cleaned", auditing: "Audited", refactoring: "Refactored", debugging: "Debugged", reducing: "Reduced", increasing: "Increased", achieving: "Achieved",
};

/** Phrases a bullet should not open with, and what to drop. */
export const FILLER_OPENERS: { re: RegExp; to: string }[] = [
  { re: /^(?:i\s+(?:was|am|have been)\s+)?responsible\s+for\s+/i, to: "" },
  { re: /^duties\s+(?:included|include)\s*[:-]?\s*/i, to: "" },
  { re: /^tasked\s+with\s+/i, to: "" },
  { re: /^in\s+charge\s+of\s+/i, to: "" },
  { re: /^(?:was\s+)?involved\s+in\s+/i, to: "" },
  { re: /^(?:was\s+)?(?:part\s+of|a\s+member\s+of)\s+(?:a\s+|the\s+)?team\s+(?:that|which|to)\s+/i, to: "" },
  { re: /^worked\s+on\s+/i, to: "" },
  { re: /^helped\s+(?:with|to)\s+/i, to: "" },
  { re: /^i\s+/i, to: "" },
];

export const FILLER_WORDS: RegExp[] = [/\bvarious\b\s*/gi, /\bvery\b\s*/gi, /\breally\b\s*/gi, /\bsuccessfully\b\s*/gi, /\bbasically\b\s*/gi, /\betc\.?(?=\s|$)/gi, /\band so on\b/gi, /\bin order to\b/gi];

export const STOPWORDS = new Set(
  `a about above across after again all also am an and any are as at be because been before being below between both but by can could did do does doing down during each either else etc few for from further had has have having he her here hers him his how i if in into is it its just like may me might more most must my no nor not now of off on once only or other our out over own per same she should so some such than that the their them then there these they this those through to too under until up us use used using very via was we were what when where which while who whom why will with within without would you your
  ability able about experience including must strong work working team teams role company position job candidate years year skills knowledge understanding responsibilities requirements required preferred plus good great excellent looking join across ensure well new help including related relevant etc based will need needs responsible opportunity apply benefits`.split(/\s+/),
);

/** Terms worth matching between a job description and a resume (single and multi word). Lower case. */
export const TERMS: string[] = [
  "javascript", "typescript", "python", "java", "kotlin", "swift", "golang", "rust", "c++", "c#", "php", "ruby", "scala", "sql", "nosql", "html", "css", "sass", "tailwind", "react", "react native", "angular", "vue", "svelte", "next.js", "nuxt", "node.js", "express.js", "nestjs", "django", "flask", "fastapi", "spring boot", "spring", "rails", "laravel", ".net", "asp.net", "graphql", "rest api", "restful", "grpc", "websockets", "redux", "jest", "cypress", "playwright", "selenium", "junit", "pytest", "webpack", "vite", "docker", "kubernetes", "terraform", "ansible", "jenkins", "github actions", "gitlab ci", "ci/cd", "aws", "azure", "gcp", "lambda", "linux", "bash", "git", "postgresql", "postgres", "mysql", "mongodb", "redis", "elasticsearch", "kafka", "rabbitmq", "spark", "hadoop", "airflow", "dbt", "snowflake", "bigquery", "tableau", "power bi", "excel", "looker", "pandas", "numpy", "scikit-learn", "tensorflow", "pytorch", "machine learning", "deep learning", "nlp", "computer vision", "llm", "data analysis", "data science", "data engineering", "etl", "statistics", "a/b testing", "product management", "agile", "scrum", "kanban", "jira", "figma", "sketch", "photoshop", "illustrator", "ux", "ui", "user research", "wireframing", "prototyping", "accessibility", "seo", "sem", "google analytics", "content marketing", "copywriting", "social media", "email marketing", "crm", "salesforce", "hubspot", "sales", "lead generation", "account management", "customer success", "customer support", "negotiation", "forecasting", "budgeting", "financial modeling", "accounting", "auditing", "payroll", "recruiting", "onboarding", "talent acquisition", "employee relations", "compliance", "risk management", "project management", "stakeholder management", "supply chain", "logistics", "procurement", "operations", "lean manufacturing", "six sigma", "quality assurance", "testing", "devops", "microservices", "system design", "distributed systems", "api design", "security", "cybersecurity", "networking", "embedded", "firmware", "ios", "android", "flutter", "unity3d", "unreal engine", "autocad", "solidworks", "matlab", "leadership", "mentoring", "communication", "presentation", "public speaking", "teaching", "curriculum", "nursing", "patient care", "clinical research",
];

const SORTED_TERMS = [...TERMS].sort((a, b) => b.length - a.length);

export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

/** Whether `term` occurs in `haystack` as a whole word/phrase (handles c++, c#, .net, node.js). */
export function hasTerm(haystack: string, term: string): boolean {
  const re = new RegExp(`(?<![a-z0-9+#.])${escapeRe(term.toLowerCase())}(?![a-z0-9+#]|\\.[a-z0-9])`, "i");
  return re.test(haystack);
}

/** The known terms a text contains, longest first, without double counting a phrase's parts. */
export function termsIn(text: string): string[] {
  const lower = text.toLowerCase();
  const found: string[] = [];
  for (const t of SORTED_TERMS) {
    if (hasTerm(lower, t)) found.push(t);
  }
  const phrases = found.filter((t) => t.includes(" "));
  return found.filter((t) => t.includes(" ") || !phrases.some((p) => p.split(" ").includes(t)));
}

/** Keywords of a job description: known terms first, then repeated distinctive words. */
export function jdKeywords(jd: string, max = 30): string[] {
  const lower = jd.toLowerCase();
  const out: string[] = [];
  for (const t of SORTED_TERMS) {
    if (hasTerm(lower, t) && !out.includes(t)) out.push(t);
  }
  // Drop single words already covered by a longer phrase ("spring" inside "spring boot").
  const phrases = out.filter((t) => t.includes(" "));
  const kept = out.filter((t) => t.includes(" ") || !phrases.some((p) => p.split(" ").includes(t)));
  const counts = new Map<string, number>();
  for (const w of lower.match(/[a-z][a-z0-9+#.-]{2,}/g) ?? []) {
    const word = w.replace(/[.-]+$/g, "");
    if (STOPWORDS.has(word) || word.length < 4 || kept.includes(word)) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  const frequent = [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([w]) => w);
  return [...kept, ...frequent].slice(0, max);
}

export const titleCase = (s: string): string => s.replace(/\b([a-z])/g, (m) => m.toUpperCase());
export const capFirst = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
export const lowerFirst = (s: string): string => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
