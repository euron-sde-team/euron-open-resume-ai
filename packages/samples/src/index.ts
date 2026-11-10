import raw from '../data/samples.json';

export type SampleLevel = 'fresher' | 'mid' | 'senior';

export interface SampleResume {
  // manifest
  id: string;
  role: string;
  field: string;
  level: SampleLevel;
  tags: string[];
  suggestedTemplate: string;
  // canonical ResumeDocument shape
  personal: { fullName: string; headline: string; email: string; phone: string; location: string };
  links: { portfolio?: string; github?: string; linkedin?: string; other?: string[] };
  summary: string;
  experience: Array<{ title: string; company: string; location: string; start: string; end: string; bullets: string[] }>;
  education: Array<{ degree: string; institution: string; location: string; start: string; end: string; details?: string; score?: string }>;
  skills: Array<{ category: string; items: string[] }>;
  projects: Array<{ name: string; description: string; link?: string; tech: string[]; bullets: string[] }>;
  certifications: Array<{ name: string; issuer: string; date: string }>;
  languages: Array<{ name: string; level: string }>;
  achievements: string[];
}

export const samples: readonly SampleResume[] = raw as SampleResume[];

export function findSample(id: string): SampleResume | undefined {
  return samples.find((s) => s.id === id);
}

export interface ListSamplesFilter {
  q?: string;
  field?: string;
  level?: SampleLevel;
}

/** Case insensitive filter. `q` matches role, field, headline, tags and skill names. */
export function listSamples(filter: ListSamplesFilter = {}): SampleResume[] {
  const q = filter.q?.trim().toLowerCase();
  const field = filter.field?.trim().toLowerCase();
  return samples.filter((s) => {
    if (filter.level && s.level !== filter.level) return false;
    if (field && s.field.toLowerCase() !== field) return false;
    if (q) {
      const hay = [s.role, s.field, s.personal.headline, ...s.tags, ...s.skills.flatMap((k) => k.items)].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}
