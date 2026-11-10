import { describe, expect, it } from 'vitest';
import { findSample, listSamples, samples } from '../src/index';

const TEMPLATES = ['resume_template', 'antique_resume_template', 'corporate_resume_template', 'executive_resume_template', 'minimalist_resume_template', 'modern_resume_template', 'multi_column_resume_template', 'obsidian_edge_resume_template', 'sage_multi_column_resume_template', 'simply_blue_resume_template', 'charcoal_glow_template', 'orangewhite_modern_template', 'entry_level_template'];

function allStrings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => allStrings(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => allStrings(x, out));
  return out;
}

describe('synthetic samples', () => {
  it('has unique slug ids and enough entries', () => {
    const ids = samples.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(samples.length).toBeGreaterThanOrEqual(50);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
  });

  it('has a valid shape', () => {
    for (const s of samples) {
      expect(['fresher', 'mid', 'senior']).toContain(s.level);
      expect(s.personal.fullName).toBeTruthy();
      expect(s.summary).toBeTruthy();
      expect(s.education.length).toBeGreaterThan(0);
      expect(s.skills.length).toBeGreaterThan(0);
      expect(s.experience.length + s.projects.length).toBeGreaterThan(0);
      for (const j of s.experience) expect(j.bullets.length).toBeGreaterThan(0);
      for (const str of allStrings(s)) {
        expect(str).toBe(str.trim());
        expect(str.length).toBeGreaterThan(0);
      }
    }
  });

  it('uses only example.com emails, 555 phones and example.com links', () => {
    for (const s of samples) {
      expect(s.personal.email.endsWith('@example.com')).toBe(true);
      expect(s.personal.phone).toMatch(/^(\+1 555 01\d\d \d\d|555-01\d\d)$/);
      const links = [s.links.portfolio, s.links.github, s.links.linkedin, ...(s.links.other ?? []), ...s.projects.map((p) => p.link)].filter(Boolean) as string[];
      for (const l of links) expect(l.startsWith('https://example.com')).toBe(true);
    }
  });

  it('contains no em dash, en dash or other non-ASCII text', () => {
    const text = JSON.stringify(samples);
    expect(text).not.toMatch(/[‒-―−]/);
    expect(text).not.toMatch(/[^\x00-\x7f]/);
  });

  it('suggests only known templates', () => {
    for (const s of samples) expect(TEMPLATES).toContain(s.suggestedTemplate);
  });

  it('covers at least 25 distinct roles and all levels', () => {
    expect(new Set(samples.map((s) => s.role)).size).toBeGreaterThanOrEqual(25);
    expect(new Set(samples.map((s) => s.level))).toEqual(new Set(['fresher', 'mid', 'senior']));
  });

  it('findSample and listSamples work', () => {
    const first = samples[0]!;
    expect(findSample(first.id)).toBe(first);
    expect(findSample('nope')).toBeUndefined();
    expect(listSamples({ level: 'senior' }).every((s) => s.level === 'senior')).toBe(true);
    expect(listSamples({ q: 'nurse' }).length).toBeGreaterThan(0);
    expect(listSamples({ field: 'healthcare' }).length).toBeGreaterThan(0);
  });
});
