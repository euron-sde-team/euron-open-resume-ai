/**
 * Offline career roadmap and project ideas, derived from the skills gap: the job
 * description's keywords the resume lacks when a job is given, otherwise the natural next
 * skills for what the resume already lists. No salaries, currencies or market claims.
 */
import type { CareerRoadmap, ProjectIdea, ResumeDocument } from "@open-resume/types";
import { hasTerm, jdKeywords, titleCase } from "./lexicon";
import { profileOf, type Profile } from "./profile";

/** What usually comes next after a skill. */
const ADJACENT: Record<string, string[]> = {
  javascript: ["typescript", "testing", "performance profiling"],
  typescript: ["design patterns", "node.js", "testing"],
  react: ["next.js", "accessibility", "performance profiling", "testing"],
  "node.js": ["system design", "postgresql", "docker", "observability"],
  python: ["fastapi", "pytest", "data analysis", "docker"],
  java: ["spring boot", "system design", "testing", "kubernetes"],
  sql: ["query optimisation", "data modeling", "dbt"],
  postgresql: ["query optimisation", "replication", "data modeling"],
  docker: ["kubernetes", "terraform", "ci/cd"],
  aws: ["terraform", "kubernetes", "cost optimisation"],
  "machine learning": ["mlops", "model evaluation", "feature engineering"],
  "data analysis": ["sql", "statistics", "dashboards"],
  excel: ["sql", "power bi", "financial modeling"],
  "project management": ["stakeholder management", "risk management", "agile"],
  sales: ["account management", "negotiation", "forecasting"],
  seo: ["content strategy", "analytics", "technical seo"],
};

const CERTS: [RegExp, string][] = [
  [/\baws\b/, "A cloud practitioner or associate-level certification from your cloud provider"],
  [/\bazure\b/, "An Azure fundamentals or associate-level certification"],
  [/\bgcp\b/, "A Google Cloud associate-level certification"],
  [/kubernetes/, "Certified Kubernetes Application Developer (CKAD)"],
  [/project management|scrum|agile/, "A recognised project management or Scrum certification"],
  [/\bsql\b|data analysis|power bi|tableau/, "A vendor certification in your main analytics tool"],
];

function gap(p: Profile): string[] {
  const have = (p.terms.join(" ") + " " + p.skills.join(" ")).toLowerCase();
  if (p.jd && p.jd.trim().length > 20) {
    const missing = jdKeywords(p.jd, 24).filter((k) => !hasTerm(have, k));
    if (missing.length) return missing.slice(0, 6);
  }
  const next: string[] = [];
  for (const t of p.terms) for (const n of ADJACENT[t] ?? []) if (!hasTerm(have, n) && !next.includes(n)) next.push(n);
  return next.slice(0, 6);
}

function nextRole(p: Profile): string {
  if (p.targetRole) return p.targetRole;
  const r = p.role.replace(/\b(aspiring|junior|jr\.?|associate|trainee|intern)\b\s*/gi, "").trim() || "Professional";
  if (/\b(principal|director|head|vp)\b/i.test(r)) return r;
  if (/\b(staff)\b/i.test(r)) return r.replace(/staff/i, "Principal");
  if (/\b(lead|manager)\b/i.test(r)) return r.replace(/lead/i, "Principal").replace(/manager/i, "Senior Manager");
  if (/\bsenior|sr\.?\b/i.test(r)) return r.replace(/senior|sr\.?/i, "Lead");
  return `Senior ${r}`;
}

export function roadmapOffline(doc: ResumeDocument, job: { jd?: string; company?: string } = {}): CareerRoadmap {
  const p = profileOf(doc, job);
  const missing = gap(p);
  const role = nextRole(p);
  const first = missing.slice(0, 3);
  const second = missing.slice(3, 6);
  const have = p.skills.slice(0, 4);
  const title = (s: string) => titleCase(s);
  const certs = CERTS.filter(([re]) => re.test(p.terms.join(" ") + " " + (p.jd ?? "").toLowerCase())).map(([, c]) => c);
  return {
    targetRole: titleCase(role),
    summary: `A ${p.jd ? "job-focused" : "growth"} plan from ${p.role} toward ${titleCase(role)}${missing.length ? `, closing these gaps: ${missing.slice(0, 5).join(", ")}` : ""}. It builds on ${have.length ? have.join(", ") : "your current skills"} and ends with proof you can show an interviewer.`,
    phases: [
      {
        title: "Close the skills gap",
        timeframe: "Weeks 1 to 6",
        goals: first.length ? first.map((s) => `Reach working level in ${s}: read the official documentation and complete one small exercise`) : ["Pick the two skills the target role asks for most and reach working level in each"],
        skills: first.length ? first : have.slice(0, 2),
        resources: ["Official documentation and getting-started guides for each skill", "One structured course or book per skill, finished rather than sampled", "A weekly review: what you built, what broke, what you will fix"],
      },
      {
        title: "Build evidence",
        timeframe: "Weeks 7 to 12",
        goals: ["Ship one project that uses the new skills together with what you already know", "Write tests and a short README that explains the decisions", ...(second.length ? [`Extend it with ${second.slice(0, 2).join(" and ")}`] : [])],
        skills: [...second, ...have.slice(0, 2)].slice(0, 6),
        resources: ["The project ideas generated for this resume", "Open source issues labelled for newcomers in a tool you use", "A code review from a more experienced peer"],
      },
      {
        title: "Position and apply",
        timeframe: "Weeks 13 to 16",
        goals: ["Add the new projects and measured results to your resume, using the job's wording where it is true", "Practise 2 mock interviews per week using the interview questions for this resume", `Apply to ${title(role)} roles and track each application`],
        skills: ["Interviewing", "Storytelling with evidence", ...have.slice(0, 1)],
        resources: ["The interview questions generated for this resume", "A peer or mentor for mock interviews", "A spreadsheet to track applications and follow-ups"],
      },
    ],
    certifications: certs.slice(0, 3),
  };
}

// ─── Projects ───────────────────────────────────────────────────────────────

interface Template {
  domain: RegExp;
  ideas: [string, string, string[], string[]][];
}

const TEMPLATES: Template[] = [
  {
    domain: /react|angular|vue|javascript|typescript|html|css|next\.js|svelte/,
    ideas: [
      ["Accessible habit tracker", "A small web app to log daily habits with streaks and a weekly chart. Focus on keyboard use, screen reader labels and offline support.", ["Local persistence", "Accessibility audit with no critical issues", "Unit and component tests"], ["react", "typescript", "testing"]],
      ["Real-time collaborative checklist", "Multiple people edit one list at once with presence indicators and conflict handling.", ["Live sync between two browsers", "Optimistic updates with rollback", "Load test notes"], ["websockets", "node.js", "typescript"]],
      ["Performance budget dashboard", "A tool that runs a page audit on a schedule, stores results and charts regressions against a budget.", ["Scheduled audits", "Trend charts", "Alert when a budget is exceeded"], ["node.js", "postgresql", "docker"]],
    ],
  },
  {
    domain: /python|django|flask|fastapi|java|spring|node\.js|golang|api|backend|sql|postgres/,
    ideas: [
      ["Personal finance API", "A REST API for accounts, transactions and monthly summaries with authentication and pagination.", ["Documented endpoints", "Integration tests against a real database", "Rate limiting"], ["rest api", "postgresql", "docker"]],
      ["Job queue with retries", "A worker system that processes tasks with retries, backoff, idempotency and a dead-letter queue, with a status dashboard.", ["Retry and backoff behaviour tested", "Idempotent handlers", "Metrics endpoint"], ["redis", "docker", "testing"]],
      ["URL shortener at scale", "A shortener with caching, analytics events and a design document covering scaling choices.", ["Cache hit-rate measured", "Load test results", "Written design with trade-offs"], ["system design", "redis", "postgresql"]],
    ],
  },
  {
    domain: /data|machine learning|pandas|numpy|tableau|power bi|excel|statistics|etl|spark|airflow|dbt/,
    ideas: [
      ["Public dataset exploration", "Pick an open dataset, clean it, ask three questions and answer them with charts and a short written report.", ["Reproducible notebook", "Documented cleaning steps", "A one-page findings summary"], ["data analysis", "sql", "pandas"]],
      ["Scheduled data pipeline", "Ingest a public source daily, validate it, load it into a warehouse table and publish a dashboard.", ["Data quality checks", "Idempotent loads", "A live dashboard"], ["etl", "airflow", "sql"]],
      ["Predictive model with evaluation", "Train and compare two models on a real dataset, report metrics honestly and explain failure cases.", ["Baseline versus improved model", "Cross-validated metrics", "Model card"], ["machine learning", "pandas", "model evaluation"]],
    ],
  },
  {
    domain: /android|ios|flutter|react native|kotlin|swift/,
    ideas: [
      ["Offline-first notes app", "A mobile notes app that works without a connection and syncs when it returns, with conflict resolution.", ["Sync tested on a flaky network", "Local database migrations", "Crash-free test run"], ["kotlin", "sqlite", "testing"]],
      ["Location-based reminders", "Reminders that trigger on arriving somewhere, respecting battery and permission rules.", ["Permission flows handled", "Battery impact measured", "UI tests"], ["android", "ios", "testing"]],
      ["Media gallery with caching", "A gallery with pagination, image caching and smooth scrolling on low-end devices.", ["Scroll performance profile", "Cache eviction policy", "Accessibility checks"], ["flutter", "performance profiling", "testing"]],
    ],
  },
];

const GENERIC: Template = {
  domain: /.*/,
  ideas: [
    ["Process improvement case study", "Pick a real workflow you know, map it, find the bottleneck, propose and (where possible) trial a change, and write up the result with measurements.", ["Before and after process map", "Measured effect on time or errors", "A one-page write-up"], ["analysis", "documentation", "stakeholder management"]],
    ["Personal portfolio site", "A clear site presenting your best three pieces of work, each with the problem, your role and the result.", ["Published and fast on mobile", "Three case studies", "Contact route that works"], ["writing", "design basics", "seo"]],
    ["Team knowledge base", "Collect and structure the how-tos you wish you had on day one for a team or club, and measure whether new people use them.", ["Searchable structure", "Usage feedback from five people", "A maintenance plan"], ["documentation", "communication", "project management"]],
  ],
};

export function projectsOffline(doc: ResumeDocument, job: { jd?: string; company?: string } = {}): ProjectIdea[] {
  const p = profileOf(doc, job);
  const have = (p.terms.join(" ") + " " + p.skills.join(" ") + " " + (p.jd ?? "")).toLowerCase();
  const template = TEMPLATES.find((t) => t.domain.test(have)) ?? GENERIC;
  const missing = gap(p);
  const levels: ProjectIdea["difficulty"][] = ["beginner", "intermediate", "advanced"];
  return template.ideas.map(([title, description, outcomes, tech], i) => {
    const merged = [...new Set([...p.skills.filter((s) => tech.some((t) => s.toLowerCase().includes(t))).slice(0, 2), ...tech, ...(missing[i] ? [missing[i]!] : [])])].slice(0, 6);
    return {
      title,
      description: `${description}${missing[i] ? ` Use it to practise ${missing[i]}, which the target asks for.` : ""}`,
      difficulty: levels[i] ?? "intermediate",
      tech: merged,
      outcomes,
      resumeBullet: `Built ${title.toLowerCase()} using ${merged.slice(0, 3).join(", ")}, ${outcomes[0]!.charAt(0).toLowerCase()}${outcomes[0]!.slice(1)}; [add the result you measured, such as users, speed or coverage].`,
    };
  });
}
