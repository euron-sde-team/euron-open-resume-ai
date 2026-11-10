import type { Metadata } from "next";
import { SamplesView } from "@/components/resume/samples-view";

export const metadata: Metadata = { title: "Samples" };

export default function SamplesPage() {
  return <SamplesView />;
}
