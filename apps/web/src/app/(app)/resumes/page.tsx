import type { Metadata } from "next";
import { ResumesView } from "@/components/resume/resume-list";

export const metadata: Metadata = { title: "Resumes" };

export default function ResumesPage() {
  return <ResumesView />;
}
