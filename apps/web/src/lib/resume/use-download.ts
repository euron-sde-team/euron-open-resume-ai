"use client";

import { useState } from "react";
import { toast } from "@open-resume/ui";
import { saveBlob } from "@/lib/download";
import { errorMessage } from "@/lib/errors";

/** Runs a download that needs the bearer token, saves the blob, and reports a failure once. */
export function useDownload() {
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, fileName: string, fetchBlob: () => Promise<Blob>) => {
    if (busy) return;
    setBusy(key);
    try {
      saveBlob(await fetchBlob(), fileName);
    } catch (e) {
      toast.error({ title: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };
  return { busy, run };
}
