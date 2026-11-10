import type { Metadata } from "next";
import { UploadView } from "@/components/resume/upload-view";

export const metadata: Metadata = { title: "Upload a resume" };

export default function NewResumePage() {
  return <UploadView />;
}
