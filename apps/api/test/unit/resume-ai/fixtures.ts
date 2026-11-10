import type { ResumeDocument } from "@open-resume/types";
import samplesJson from "../../../../../packages/samples/data/samples.json";

export const samples = samplesJson as unknown as (ResumeDocument & { id: string; level: string })[];

export const asDocument = (s: ResumeDocument & { id?: string }): ResumeDocument => {
  const { personal, links, summary, experience, education, skills, projects, certifications, languages, achievements } = s;
  return { personal, links, summary, experience, education, skills, projects, certifications, languages, achievements };
};

export const BARE: ResumeDocument = {
  personal: { fullName: "Sam Rowe", email: "sam.rowe@example.com" },
  experience: [{ title: "Developer", company: "Northwind", start: "2020", end: "2023", bullets: ["Responsible for various tasks", "Worked on the website", "Helped with testing"] }],
  skills: [{ category: "Skills", items: ["Excel"] }],
};

export const STRONG: ResumeDocument = {
  personal: { fullName: "Sam Rowe", email: "sam.rowe@example.com", phone: "+1 555 0100 12", location: "Leeds, UK", headline: "Backend Developer" },
  links: { github: "https://github.com/example-sam" },
  summary: "Backend developer who builds reliable APIs with Node.js and PostgreSQL.",
  experience: [
    {
      title: "Backend Developer",
      company: "Northwind",
      start: "2020",
      end: "2023",
      bullets: [
        "Built a REST API in Node.js and PostgreSQL serving 40,000 requests per day.",
        "Reduced p95 latency by 38% by adding Redis caching and query indexes.",
        "Led migration of 12 services to Docker and Kubernetes, cutting deploy time from 40 to 6 minutes.",
        "Wrote integration tests that raised coverage from 52% to 89%.",
        "Mentored 3 junior developers through code review and pairing.",
        "Automated CI/CD with GitHub Actions, shipping 15 releases per month.",
      ],
    },
  ],
  education: [{ degree: "B.S. in Computer Science", institution: "Calder Bay University", start: "2016", end: "2020" }],
  skills: [
    { category: "Languages", items: ["TypeScript", "JavaScript", "SQL", "Python"] },
    { category: "Tools", items: ["Node.js", "PostgreSQL", "Redis", "Docker", "Kubernetes", "AWS", "Git"] },
  ],
};

export const JD = `Backend Engineer
We are looking for a backend engineer to build REST APIs with Node.js and PostgreSQL.
You will work with Docker, Kubernetes, AWS and Redis. Experience with CI/CD, testing and
GraphQL is a plus. Strong communication and system design skills. Kafka knowledge helps.`;
