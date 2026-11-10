import { Suspense } from "react";
import type { Metadata } from "next";
import { ResumeReport } from "@/components/resume/report/resume-report";

export const metadata: Metadata = { title: "Resume" };

export default async function ResumePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={null}>
      <ResumeReport id={id} />
    </Suspense>
  );
}
