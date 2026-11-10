/** Every React Query key in one place, so cache surgery (optimistic updates, invalidation) finds them. */
type F = Record<string, unknown>;

export const qk = {
  me: ["me"] as const,
  meta: ["meta"] as const,
  sessions: ["sessions"] as const,

  usage: ["usage"] as const,
  preferences: ["preferences"] as const,

  // Resumes
  resumes: ["resumes"] as const,
  resume: (id: string) => ["resumes", "detail", id] as const,
  resumeStatus: (id: string) => ["resumes", "status", id] as const,
  templates: ["templates"] as const,
  drafts: ["drafts"] as const,

  // Admin
  admin: {
    session: ["admin", "session"] as const,
    all: ["admin"] as const,
    list: (area: string, f?: F) => ["admin", area, "list", f ?? {}] as const,
    detail: (area: string, id: string) => ["admin", area, "detail", id] as const,
    area: (area: string) => ["admin", area] as const,
  },
};
