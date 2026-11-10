import { Suspense } from "react";
import type { Metadata } from "next";
import { BuilderView } from "@/components/resume/builder/builder-view";

export const metadata: Metadata = { title: "Builder" };

export default function BuilderPage() {
  return (
    <Suspense fallback={null}>
      <BuilderView />
    </Suspense>
  );
}
