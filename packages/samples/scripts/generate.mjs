#!/usr/bin/env node
// Deterministic generator for the synthetic sample resume library.
// Usage: node packages/samples/scripts/generate.mjs
// Every person, company, school and link is invented. Same seed => same output.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rolesA } from './roles-a.mjs';
import { rolesB } from './roles-b.mjs';

const SEED = 20261110;
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'samples.json');
const NOW = { y: 2026, m: 10 }; // reference "today" so output never drifts

// ---------- seeded PRNG (mulberry32) ----------
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(SEED);
const int = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
const pick = (arr) => arr[Math.floor(rng() * arr.length)];
const chance = (p) => rng() < p;
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- token filling ----------
// Repeated tokens in one string are ordered: asc for p,m,u,k,n,h; desc for d,q.
const RANGES = { p: [12, 58], q: [8, 30], u: [62, 96], n: [12, 95], k: [3, 18], m: [2, 9], h: [15, 80], d: [18, 60], $: [20, 480], y: [2021, 2025] };
const DESC = new Set(['d', 'q']);
const GAP = { p: 8, q: 6, u: 6, n: 8, k: 3, m: 1, h: 10, d: 8, $: 40, y: 1 };
function fill(text) {
  const found = {};
  for (const mt of text.matchAll(/\{([pqunkmhd$y])\}/g)) found[mt[1]] = (found[mt[1]] || 0) + 1;
  const vals = {};
  for (const [t, count] of Object.entries(found)) {
    const [lo, hi] = RANGES[t];
    let list;
    for (let tries = 0; tries < 50; tries++) {
      list = Array.from({ length: count }, () => int(lo, hi));
      list.sort((a, b) => a - b);
      let ok = true;
      for (let i = 1; i < list.length; i++) if (list[i] - list[i - 1] < GAP[t]) ok = false;
      if (ok || hi - lo < GAP[t] * count) break;
    }
    if (DESC.has(t)) list.reverse();
    vals[t] = list;
  }
  const used = {};
  return text.replace(/\{([pqunkmhd$y])\}/g, (_, t) => {
    const v = vals[t][(used[t] = (used[t] || 0) + 1) - 1];
    return t === '$' ? `$${v}K` : String(v);
  });
}

// ---------- fictional pools ----------
const FIRST = ['Maya', 'Arjun', 'Lena', 'Tomas', 'Priya', 'Omar', 'Chloe', 'Ravi', 'Elena', 'Kofi', 'Nora', 'Diego', 'Aiko', 'Samir', 'Hannah', 'Mateo', 'Zara', 'Idris', 'Freya', 'Kenji', 'Amara', 'Lucas', 'Sofia', 'Dev', 'Mira', 'Jonah', 'Leila', 'Anton', 'Tara', 'Noel', 'Imani', 'Felix', 'Rosa', 'Hugo', 'Anika', 'Callum', 'Yara', 'Pavel', 'Ines', 'Rohan', 'Greta', 'Emeka', 'Lucia', 'Dmitri', 'Naomi', 'Sven', 'Farah', 'Theo', 'Meera', 'Bruno', 'Alma', 'Jules', 'Sana', 'Marcus', 'Odette', 'Kiran', 'Winnie', 'Ezra', 'Paloma', 'Cyrus'];
const LAST = ['Okafor', 'Lindqvist', 'Marchetti', 'Varma', 'Hollis', 'Tanaka', 'Delacroix', 'Mbeki', 'Orlov', 'Castellan', 'Bhatt', 'Rowntree', 'Aguilar', 'Nakamura', 'Fairweather', 'Haddad', 'Kowalczyk', 'Ibarra', 'Thorne', 'Menon', 'Ashworth', 'Quillen', 'Sorensen', 'Adeyemi', 'Brandt', 'Valdez', 'Perrault', 'Chowdhury', 'Whitlock', 'Ferreira', 'Narang', 'Lockhart', 'Yilmaz', 'Dunmore', 'Santoro', 'Achterberg', 'Pillai', 'Moreau', 'Kasprzak', 'Oyelaran', 'Halvorsen', 'Rinaldi', 'Sethi', 'Brightwell', 'Montoya', 'Eberhart', 'Nwosu', 'Calloway', 'Draper', 'Ito', 'Vasquez', 'Lund', 'Ghosh', 'Pemberton', 'Ruiz', 'Tavares', 'Wexler', 'Zielinski', 'Abara', 'Keller'];
const CITIES = ['Portland, OR', 'Austin, TX', 'Toronto, ON', 'Manchester, UK', 'Bengaluru, India', 'Pune, India', 'Melbourne, Australia', 'Dublin, Ireland', 'Lagos, Nigeria', 'Singapore', 'Berlin, Germany', 'Nairobi, Kenya', 'Sao Paulo, Brazil', 'Denver, CO', 'Chicago, IL', 'Leeds, UK', 'Calgary, AB', 'Lisbon, Portugal', 'Atlanta, GA', 'Wellington, New Zealand', 'Hyderabad, India', 'Seattle, WA'];
const PREFIX = ['Brightfield', 'Cedarline', 'Quillstone', 'Larkspur', 'Tidemill', 'Ironbark', 'Foxglove', 'Mistral Hollow', 'Pinecrest Row', 'Redwillow', 'Stonebridge Lane', 'Wrenfield', 'Amberleaf', 'Copperfield Ridge', 'Northwind', 'Harbor & Pine', 'Oakmere', 'Silverbrook', 'Thistledown', 'Kestrel Bay', 'Maplegate', 'Ravenhill', 'Juniper Lake', 'Sandpiper', 'Blueharbor', 'Elmstead', 'Greywater', 'Hollowbrook', 'Lanternside', 'Moonvale', 'Netherfield Green', 'Orchardway', 'Primrose Court', 'Quarry Hill', 'Rookwood', 'Starling Point', 'Timberline Park', 'Umberfield', 'Vesper Cove', 'Willowmere'];
const SUFFIX = {
  tech: ['Systems', 'Software', 'Labs', 'Digital', 'Cloud Works', 'Technologies', 'Data Works'],
  data: ['Analytics', 'Insights', 'Data Labs', 'Intelligence', 'Research Group'],
  health: ['Health', 'Care Partners', 'Medical Group', 'Wellness Network', 'Community Hospital'],
  finance: ['Financial', 'Capital Partners', 'Advisory', 'Holdings', 'Group'],
  logistics: ['Logistics', 'Freight', 'Supply Co', 'Distribution', 'Trading Company'],
  media: ['Media', 'Studio', 'Creative', 'Communications', 'Press'],
  edu: ['Academy', 'High School', 'Learning Trust', 'School District', 'Grammar School'],
  build: ['Construction', 'Engineering Group', 'Civil Works', 'Infrastructure', 'Builders'],
  retail: ['Retail', 'Goods Co', 'Commerce', 'Market Group', 'Brands'],
  legal: ['Law Offices', 'Legal Group', 'Attorneys', 'Counsel Partners'],
  mfg: ['Manufacturing', 'Industries', 'Components', 'Fabrication', 'Dynamics'],
};
const SCHOOLS = ['Lakeside Institute of Technology', 'Marlowe Ridge University', 'Fernhill College', 'Northgate Institute of Science', 'Calder Bay University', 'Westmere Polytechnic', 'Oakhaven State College', 'Rivermont University', 'Eastbrook Institute of Arts', 'Halden Coast University', 'Stillbrook Technical College', 'Glenmoor University', 'Aldergrove Business School', 'Pennant Hill College'];
const OTHER_LANGS = ['Spanish', 'Hindi', 'French', 'German', 'Portuguese', 'Mandarin', 'Arabic', 'Swahili', 'Japanese', 'Polish'];
const LEVELS_LANG = ['Native', 'Fluent', 'Professional working', 'Intermediate', 'Basic'];
const SENIOR_EXTRA_SKILLS = ['Leadership', ['Mentoring', 'Hiring', 'Roadmap planning', 'Budget ownership']];
const GENERIC_SENIOR_BULLETS = [
  'Coached {m} direct reports through promotion cycles, with {m} advancing a level within a year.',
  'Owned a yearly budget of {$} and delivered every quarter within {m} percent of plan.',
  'Defined a three year strategy with executives and translated it into quarterly goals for {k} teams.',
  'Interviewed and hired {k} people, building a team with turnover under {m} percent.',
  'Introduced blameless reviews that reduced repeat issues by {p}% across the department.',
  'Represented the function in cross company planning and secured funding for {k} priority initiatives.',
  'Documented standards and onboarding material that cut ramp up time for new hires from {d} to {d} days.',
  'Partnered with finance and legal to negotiate {k} vendor contracts that saved {$} over their terms.',
];
const ACH = {
  fresher: ['Dean\'s list for {m} semesters.', 'Finalist in a university project showcase ({y}).', 'Volunteered {h} hours at a community learning centre.', 'Captain of a campus club with {k} active members.', 'Scholarship recipient for academic merit ({y}).'],
  mid: ['Received a team excellence award for cross department collaboration ({y}).', 'Presented at a regional professional meetup on lessons from a large project ({y}).', 'Volunteer mentor in a community upskilling program for {k} participants.', 'Published an internal playbook adopted by {m} teams.'],
  senior: ['Received the annual leadership award for building a high performing team ({y}).', 'Keynote speaker at a regional industry conference ({y}).', 'Mentor in a community program that has supported {n} career changers.', 'Published an internal playbook adopted by {m} departments.', 'Advisory board member for a university program ({y}).'],
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const fmt = (idx) => `${MONTHS[idx % 12]} ${Math.floor(idx / 12)}`; // idx = year*12 + month0
const nowIdx = NOW.y * 12 + (NOW.m - 1);

// ---------- builders ----------
const usedNames = new Set();
function makeName() {
  for (;;) {
    const n = `${pick(FIRST)} ${pick(LAST)}`;
    if (!usedNames.has(n)) { usedNames.add(n); return n; }
  }
}
function phone() {
  return chance(0.65) ? `+1 555 01${String(int(0, 99)).padStart(2, '0')} ${String(int(0, 99)).padStart(2, '0')}` : `555-01${String(int(0, 99)).padStart(2, '0')}`;
}
function companyPicker(grp) {
  const used = new Set();
  return () => {
    for (;;) {
      const c = `${pick(PREFIX)} ${pick(SUFFIX[grp])}`;
      if (!used.has(c)) { used.add(c); return c; }
    }
  };
}
function makeBulletSource(role, level) {
  const base = role.bullets.concat(level === 'senior' ? GENERIC_SENIOR_BULLETS : []);
  let queue = [];
  return () => {
    if (queue.length === 0) queue = shuffle(base);
    return fill(queue.pop());
  };
}

function build(role, roleIdx, level, slot) {
  const dense = role.key === 'full-stack-developer' && level === 'senior';
  const projectsOnly = role.key === 'frontend-developer' && level === 'fresher';
  const name = makeName();
  const [first, last] = name.split(' ');
  const handle = `${first}-${last}`.toLowerCase();
  const nextBullet = makeBulletSource(role, level);
  const nextCompany = companyPicker(role.grp);

  // --- experience ---
  let jobCount;
  if (level === 'fresher') jobCount = projectsOnly ? 0 : role.projects.length === 0 || roleIdx % 3 !== 0 ? 1 : 0;
  else if (level === 'mid') jobCount = int(2, 3);
  else jobCount = dense ? 6 : int(4, 5);

  const titleFor = (i, n) => {
    if (level === 'fresher') return `${role.role} Intern`;
    if (level === 'mid') return i === 0 ? role.titles[0] : role.titles[1];
    // senior: oldest -> newest ladder
    const ladder = n === 6 ? [0, 0, 1, 1, 2, 2] : n === 5 ? [0, 1, 1, 2, 2] : [0, 1, 1, 2];
    return role.titles[ladder[i]];
  };
  const bulletsFor = (i, n) => {
    if (level === 'fresher') return role.projects.length === 0 ? 3 : 2;
    const fromNewest = n - 1 - i;
    if (dense) return [2, 2, 2, 3, 3, 4][i];
    return fromNewest === 0 ? 4 : fromNewest >= n - 1 && n > 3 ? 2 : 3;
  };

  // build chronologically backwards from "now"
  const experienceNewestFirst = [];
  let endIdx = level === 'fresher' ? (2026 - 0) * 12 + 7 : nowIdx; // fresher internship ended Aug 2026 or earlier
  if (level === 'fresher') endIdx = 2025 * 12 + 7;
  let earliestStart = endIdx;
  for (let i = jobCount - 1; i >= 0; i--) {
    const isLatest = i === jobCount - 1;
    const tenure = level === 'fresher' ? 3 : int(20, dense ? 36 : 50);
    const startIdx = endIdx - tenure;
    const loc = pick(CITIES);
    experienceNewestFirst.push({
      title: titleFor(i, jobCount),
      company: nextCompany(),
      location: loc,
      start: fmt(startIdx),
      end: isLatest && level !== 'fresher' ? 'Present' : fmt(endIdx),
      bullets: null,
      _n: bulletsFor(i, jobCount),
    });
    earliestStart = startIdx;
    endIdx = startIdx - int(0, 2);
  }
  const experience = experienceNewestFirst; // already newest first (loop built from newest)
  for (const job of experience) {
    job.bullets = Array.from({ length: job._n }, () => nextBullet());
    delete job._n;
  }

  // --- education ---
  let gradYear;
  if (level === 'fresher') gradYear = chance(0.5) ? 2026 : 2025;
  else gradYear = Math.floor(earliestStart / 12) - (earliestStart % 12 >= 5 ? 0 : 1);
  const school = pick(SCHOOLS);
  const education = [{
    degree: role.degree,
    institution: school,
    location: pick(CITIES),
    start: String(gradYear - (role.degree.startsWith('M.') ? 2 : 4)),
    end: String(gradYear),
  }];
  if (level !== 'senior' && chance(0.7)) education[0].details = `Relevant coursework: ${role.course.join(', ')}.`;
  if (level === 'fresher') education[0].score = chance(0.5) ? `GPA ${(3.2 + rng() * 0.7).toFixed(1)}/4.0` : pick(['First Class Honours', 'Distinction', 'Cum laude']);
  if (level === 'senior' && chance(0.4)) education[0].details = 'Graduated with honours.';
  if (level === 'senior' && chance(0.3)) {
    education.push({ degree: 'Executive Certificate in Leadership', institution: pick(SCHOOLS.filter((s) => s !== school)), location: pick(CITIES), start: String(Math.min(gradYear + 10, 2025)), end: String(Math.min(gradYear + 10, 2025)) });
  }

  // --- skills ---
  let skills = role.skills.map(([category, items]) => ({ category, items: level === 'fresher' ? items.slice(0, 3) : [...items] }));
  if (level === 'fresher' && chance(0.4)) skills = skills.slice(0, 2);
  if (level === 'senior') skills.push({ category: SENIOR_EXTRA_SKILLS[0], items: SENIOR_EXTRA_SKILLS[1] });

  // --- projects ---
  let projects = [];
  const mk = (p, linkProb) => {
    const out = { name: p[0], description: p[1], tech: [...p[2]], bullets: p[3].map(fill) };
    if (chance(linkProb)) out.link = `https://example.com/projects/${slug(p[0])}`;
    return out;
  };
  if (level === 'fresher') projects = role.projects.map((p) => mk(p, 0.8));
  else if (level === 'mid' && role.projects.length && chance(0.6)) projects = [mk(role.projects[int(0, role.projects.length - 1)], 0.5)];
  else if (level === 'senior' && !dense && role.projects.length && chance(0.3)) projects = [mk(role.projects[0], 0.4)];

  // --- certifications ---
  const certs = level === 'fresher' && chance(0.5) ? [] : role.certs.map(([n, issuer]) => ({ name: n, issuer, date: fmt(int(2019, 2025) * 12 + int(0, 11)) }));
  if (level === 'fresher') certs.splice(1);

  // --- languages ---
  const languages = [{ name: 'English', level: pick(['Native', 'Fluent']) }];
  const extra = int(0, 2);
  for (const l of shuffle(OTHER_LANGS).slice(0, extra)) languages.push({ name: l, level: pick(LEVELS_LANG.slice(1)) });

  // --- achievements ---
  const achPool = shuffle(ACH[level]);
  const achievements = achPool.slice(0, level === 'fresher' ? int(1, 2) : level === 'mid' ? int(0, 2) : int(2, 3)).map(fill);

  // --- summary ---
  const spanYears = level === 'fresher' ? 0 : Math.max(2, Math.round((nowIdx - earliestStart) / 12));
  const closers = ['Known for clear communication, steady delivery and measurable results.', 'Works well with cross functional teams and documents decisions so others can build on them.', 'Takes ownership, asks good questions and follows through.'];
  let summary;
  if (level === 'fresher') {
    summary = `Recent graduate aiming for a ${role.titles[0]} position, with ${projectsOnly ? 'project' : 'internship and project'} experience in ${role.focus}. Eager to learn quickly, ship carefully and grow within a supportive team.`;
    if (slot === 1 && chance(0.5)) summary = `Recent graduate seeking a ${role.titles[0]} role in ${role.focus}.`;
  } else if (level === 'mid') {
    summary = `${role.role} with ${spanYears} years of experience in ${role.focus}. ${pick(closers)}`;
  } else {
    summary = `Seasoned ${role.role} with ${spanYears} years of experience in ${role.focus}. Has led teams, owned budgets and mentored the next generation of practitioners. ${pick(closers)}`;
    if (dense) summary += ' Comfortable moving between hands on delivery, strategy and executive communication, and known for turning ambiguous goals into plans that teams can execute.';
  }

  // --- links ---
  const links = {};
  const techy = ['Software Engineering', 'Data and AI', 'Infrastructure'].includes(role.field);
  const creative = ['Content and Media', 'Product and Design'].includes(role.field);
  if (techy && chance(0.8)) links.github = `https://example.com/code/${handle}`;
  if ((creative || level === 'senior') && chance(0.7)) links.portfolio = `https://example.com/portfolio/${handle}`;
  if (chance(0.75)) links.linkedin = `https://example.com/in/${handle}`;
  if (dense) links.other = [`https://example.com/talks/${handle}`, `https://example.com/writing/${handle}`];

  // --- headline & template ---
  const latestTitle = experience[0] ? (level === 'fresher' ? role.titles[0] : experience[0].title) : `Aspiring ${role.role}`;
  let suggestedTemplate;
  if (level === 'fresher') suggestedTemplate = chance(0.55) ? 'entry_level_template' : pick(role.tpl);
  else if (level === 'senior' && chance(0.4)) suggestedTemplate = 'executive_resume_template';
  else suggestedTemplate = pick(role.tpl);
  if (dense) suggestedTemplate = 'multi_column_resume_template';

  const loc = pick(CITIES);
  const doc = {
    id: `${role.key}-${level}`,
    role: role.role,
    field: role.field,
    level,
    tags: [role.key, slug(role.field), level, ...skills[0].items.slice(0, 3).map((s) => s.toLowerCase())],
    suggestedTemplate,
    personal: { fullName: name, headline: latestTitle, email: `${handle.replace('-', '.')}@example.com`, phone: phone(), location: loc },
    links,
    summary,
    experience,
    education,
    skills,
    projects,
    certifications: certs,
    languages,
    achievements,
  };
  if (projectsOnly) doc.tags.push('projects-only');
  if (dense) doc.tags.push('dense');
  return doc;
}

// ---------- assemble ----------
const roles = [...rolesA, ...rolesB];
const LEVEL_ORDER = ['fresher', 'mid', 'senior'];
const samples = [];
roles.forEach((role, i) => {
  samples.push(build(role, i, LEVEL_ORDER[i % 3], 0));
  samples.push(build(role, i, LEVEL_ORDER[(i + 1) % 3], 1));
});

// ---------- clean: trim, collapse spaces, ASCII only ----------
function clean(v, path = '') {
  if (typeof v === 'string') {
    const s = v.replace(/\s+/g, ' ').trim();
    if (/[^\x20-\x7e]/.test(s)) throw new Error(`non-ASCII at ${path}: ${s}`);
    if (s.includes('{') || s.includes('}')) throw new Error(`unfilled token at ${path}: ${s}`);
    return s;
  }
  if (Array.isArray(v)) return v.map((x, i) => clean(x, `${path}[${i}]`));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clean(x, `${path}.${k}`)]));
  return v;
}
const out = clean(samples);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
console.log(`wrote ${out.length} samples, ${new Set(out.map((s) => s.role)).size} roles -> ${OUT}`);
