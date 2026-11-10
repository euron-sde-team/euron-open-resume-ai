#!/usr/bin/env node
// Plain node validation (same rules as test/samples.test.ts), no dependencies.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'samples.json');
const text = readFileSync(file, 'utf8');
const data = JSON.parse(text);
const TEMPLATES = ['resume_template', 'antique_resume_template', 'corporate_resume_template', 'executive_resume_template', 'minimalist_resume_template', 'modern_resume_template', 'multi_column_resume_template', 'obsidian_edge_resume_template', 'sage_multi_column_resume_template', 'simply_blue_resume_template', 'charcoal_glow_template', 'orangewhite_modern_template', 'entry_level_template'];
const errs = [];
const err = (m) => errs.push(m);
const strings = [];
(function walk(v, p) {
  if (typeof v === 'string') { strings.push([p, v]); if (v !== v.trim() || v === '') err(`untrimmed or empty string at ${p}`); }
  else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}[${i}]`));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${p}.${k}`);
})(data, '$');
if (/[‒-―−]/.test(text)) err('non-ASCII dash found');
if (/[^\x00-\x7f]/.test(text)) err('non-ASCII character found');
const ids = new Set();
for (const s of data) {
  if (ids.has(s.id)) err(`duplicate id ${s.id}`);
  ids.add(s.id);
  if (!/^[a-z0-9-]+$/.test(s.id)) err(`bad id ${s.id}`);
  if (!['fresher', 'mid', 'senior'].includes(s.level)) err(`${s.id}: level`);
  if (!TEMPLATES.includes(s.suggestedTemplate)) err(`${s.id}: template ${s.suggestedTemplate}`);
  if (!/^[^@\s]+@example\.com$/.test(s.personal.email)) err(`${s.id}: email`);
  if (!/^(\+1 555 01\d\d \d\d|555-01\d\d)$/.test(s.personal.phone)) err(`${s.id}: phone ${s.personal.phone}`);
  const links = [s.links.portfolio, s.links.github, s.links.linkedin, ...(s.links.other || []), ...s.projects.map((p) => p.link)].filter(Boolean);
  for (const l of links) if (!l.startsWith('https://example.com/')) err(`${s.id}: link ${l}`);
  if (!s.summary || !s.education.length || !s.skills.length) err(`${s.id}: missing core sections`);
  if (!s.experience.length && !s.projects.length) err(`${s.id}: no experience and no projects`);
  for (const j of s.experience) if (!j.bullets.length) err(`${s.id}: job without bullets`);
}
const roles = new Set(data.map((s) => s.role));
if (roles.size < 25) err(`only ${roles.size} roles`);
if (Buffer.byteLength(text) > 600 * 1024) err('file larger than 600 KB');
if (errs.length) { console.error(errs.join('\n')); process.exit(1); }
console.log(`ok: ${data.length} samples, ${roles.size} roles, ${(Buffer.byteLength(text) / 1024).toFixed(0)} KB`);
