"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, FolderOpen } from "lucide-react";
import { DEFAULT_TEMPLATE_ID, type BuilderMessage, type ResumeDocument, type ResumeDraftSummary, type TemplateId } from "@open-resume/types";
import { Button, cn, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, toast } from "@open-resume/ui";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { UnderlineTabs } from "@/components/common/underline-tabs";
import { useShell } from "@/components/app/shell-context";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { qk } from "@/lib/query-keys";
import { documentTitle, hasContent } from "@/lib/resume/document";
import { asTemplateId, fileNameFor } from "@/lib/resume/format";
import { isQuotaError } from "@/lib/resume/quota";
import { validateResumeFile } from "@/lib/resume/upload-validation";
import { useDownload } from "@/lib/resume/use-download";
import { usePreviewHtml } from "@/lib/resume/use-preview";
import { TopBar } from "../page-frame";
import { PreviewFrame } from "../preview-frame";
import { QuotaNotice, useQuota } from "../quota-notice";
import { TemplateChooser } from "../template-chooser";
import { ChatPanel, WELCOME } from "./chat-panel";
import { DraftsDrawer } from "./drafts-drawer";
import { SectionEditor } from "./section-editor";

type LeftView = "chat" | "edit" | "preview";

export function BuilderView() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const shell = useShell();
  const { quota } = useQuota();
  const dl = useDownload();

  const [draftId, setDraftId] = useState<string | null>(null);
  const [name, setName] = useState("Untitled resume");
  const [templateId, setTemplateId] = useState<TemplateId>(DEFAULT_TEMPLATE_ID);
  const [doc, setDoc] = useState<ResumeDocument>({});
  const [messages, setMessages] = useState<BuilderMessage[]>([WELCOME]);
  const [nextPrompts, setNextPrompts] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [view, setView] = useState<LeftView>("chat");
  const [chatBusy, setChatBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [analysing, setAnalysing] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [pendingOpen, setPendingOpen] = useState<string | null>(null);
  const [loadingDraft, setLoadingDraft] = useState(false);

  const loadedFor = useRef<string | null>(null);
  const docRef = useRef(doc);
  docRef.current = doc;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const content = hasContent(doc);
  const preview = usePreviewHtml(doc, templateId, { enabled: content });

  // Load the draft named in the URL (once per id; a save that sets the id does not reload).
  const draftParam = params.get("draft");
  useEffect(() => {
    if (!draftParam || loadedFor.current === draftParam) return;
    loadedFor.current = draftParam;
    setLoadingDraft(true);
    api()
      .drafts.get(draftParam)
      .then((d) => {
        // A newer navigation (or a "new resume") owns the screen now.
        if (loadedFor.current !== draftParam) return;
        setDraftId(d.id);
        setName(d.name || "Untitled resume");
        setTemplateId(asTemplateId(d.templateId));
        setDoc(d.document ?? {});
        setMessages([{ role: "assistant", content: `Opened "${d.name || "Untitled resume"}". Tell me what to change, or edit the sections directly.` }]);
        setNextPrompts([]);
        setDirty(false);
      })
      .catch((e: unknown) => {
        if (loadedFor.current === draftParam) toast.error({ title: errorMessage(e) });
      })
      .finally(() => {
        if (loadedFor.current === draftParam) setLoadingDraft(false);
      });
  }, [draftParam]);

  // Unsaved work survives a stray reload prompt.
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const edit = useCallback((d: ResumeDocument) => {
    setDoc(d);
    setDirty(true);
  }, []);

  const send = useCallback(
    async (text: string): Promise<boolean> => {
      const next: BuilderMessage[] = [...messagesRef.current, { role: "user", content: text }];
      setMessages(next);
      setChatBusy(true);
      try {
        const r = await api().builder.chat({ messages: next.filter((m) => m !== WELCOME), document: hasContent(docRef.current) ? docRef.current : undefined });
        setMessages([...next, { role: "assistant", content: r.assistant }]);
        setDoc(r.document ?? {});
        setNextPrompts(r.nextPrompts ?? []);
        setDirty(true);
        void qc.invalidateQueries({ queryKey: qk.usage });
        return true;
      } catch (e) {
        setMessages(messagesRef.current.slice(0, -1));
        toast.error({ title: isQuotaError(e) ? "Monthly runs used up" : errorMessage(e), description: isQuotaError(e) ? "You can still edit the sections, preview and download." : undefined });
        if (isQuotaError(e)) void qc.invalidateQueries({ queryKey: qk.usage });
        return false;
      } finally {
        setChatBusy(false);
      }
    },
    [qc],
  );

  const importFile = useCallback(
    async (file: File) => {
      const check = validateResumeFile(file, quota.maxUploadMb);
      if (!check.ok) {
        toast.error({ title: check.message ?? "That file cannot be used." });
        return;
      }
      setImporting(true);
      const base = messagesRef.current;
      setMessages([...base, { role: "user", content: `Imported ${file.name}` }]);
      try {
        const r = await api().builder.import(file);
        setMessages([...base, { role: "user", content: `Imported ${file.name}` }, { role: "assistant", content: r.assistant }]);
        setDoc(r.document ?? {});
        setDirty(true);
        void qc.invalidateQueries({ queryKey: qk.usage });
      } catch (e) {
        setMessages(base);
        toast.error({ title: errorMessage(e) });
      } finally {
        setImporting(false);
      }
    },
    [qc, quota.maxUploadMb],
  );

  const save = async () => {
    setSaving(true);
    try {
      const body = { name: name.trim() || documentTitle(doc), templateId, document: doc };
      const saved = draftId ? await api().drafts.update(draftId, body) : await api().drafts.create(body);
      setDraftId(saved.id);
      setDirty(false);
      void qc.invalidateQueries({ queryKey: qk.drafts });
      if (draftParam !== saved.id) {
        loadedFor.current = saved.id;
        router.replace(`/builder?draft=${encodeURIComponent(saved.id)}`, { scroll: false });
      }
      toast.success({ title: "Draft saved" });
    } catch (e) {
      toast.error({ title: errorMessage(e) });
    } finally {
      setSaving(false);
    }
  };

  const analyse = async () => {
    setAnalysing(true);
    try {
      const r = await api().resumes.fromDocument({ document: doc, templateId, title: name.trim() || documentTitle(doc) });
      void qc.invalidateQueries({ queryKey: qk.resumes });
      void qc.invalidateQueries({ queryKey: qk.usage });
      router.push(`/resumes/${r.id}`);
    } catch (e) {
      setAnalysing(false);
      toast.error({ title: errorMessage(e) });
    }
  };

  const fresh = () => {
    loadedFor.current = null;
    setDraftId(null);
    setName("Untitled resume");
    setDoc({});
    setMessages([WELCOME]);
    setNextPrompts([]);
    setDirty(false);
    router.replace("/builder", { scroll: false });
  };

  const openDraft = (d: ResumeDraftSummary) => {
    setDrawer(false);
    if (d.id === draftId) return;
    if (dirty && content) setPendingOpen(d.id);
    else router.push(`/builder?draft=${encodeURIComponent(d.id)}`);
  };

  const mobile = shell.mobile;
  const leftView: LeftView = mobile ? view : view === "preview" ? "chat" : view;
  const showLeft = !mobile || view !== "preview";
  const showRight = !mobile || view === "preview";
  const tabs = useMemo(
    () => [
      { value: "chat" as const, label: "Chat" },
      { value: "edit" as const, label: "Edit sections" },
      ...(mobile ? [{ value: "preview" as const, label: "Preview" }] : []),
    ],
    [mobile],
  );
  const file = (ext: string) => fileNameFor(name || documentTitle(doc), ext);

  return (
    <div className="flex h-full flex-col">
      <TopBar className="h-auto min-h-14 flex-wrap gap-x-2 gap-y-2 border-b border-border py-2">
        <input
          aria-label="Draft name"
          data-testid="draft-name"
          value={name}
          maxLength={120}
          onChange={(e) => {
            setName(e.target.value);
            setDirty(true);
          }}
          className="min-w-0 flex-1 basis-40 truncate sm:max-w-[16rem] rounded-sm bg-transparent px-1 font-display text-[16px] font-semibold tracking-[-0.01em] hover:bg-muted focus-visible:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <span className="hidden text-[12.5px] text-muted-foreground sm:inline" data-testid="draft-state">
          {dirty ? "Unsaved" : draftId ? "Saved" : ""}
        </span>
        <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto sm:flex-1 sm:flex-nowrap">
        <Button variant="ghost" size="sm" onClick={() => setDrawer(true)} data-testid="drafts-open">
          <FolderOpen /> <span className="hidden sm:inline">Drafts</span>
          <span className="sm:hidden sr-only">Drafts</span>
        </Button>
        <span className="hidden md:inline">
          <TemplateChooser
            value={templateId}
            onChange={(t) => {
              setTemplateId(t);
              setDirty(true);
            }}
          />
        </span>
        <Button variant="outline" size="sm" loading={saving} disabled={!content} onClick={() => void save()} data-testid="draft-save">
          Save
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" disabled={!content} data-testid="download-menu">
              Download <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem data-testid="download-pdf" onSelect={() => void dl.run("pdf", file("pdf"), () => api().builder.export(doc, templateId, "pdf"))}>
              PDF
            </DropdownMenuItem>
            <DropdownMenuItem data-testid="download-docx" onSelect={() => void dl.run("docx", file("docx"), () => api().builder.export(doc, templateId, "docx"))}>
              Word (DOCX)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button size="sm" loading={analysing} disabled={!content || quota.exhausted} onClick={() => void analyse()} data-testid="analyse">
          Analyse this resume
        </Button>
        </div>
      </TopBar>

      <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(380px,0.85fr)_1.15fr]">
        {showLeft ? (
          <div className="flex min-h-0 flex-col border-border md:border-r">
            <div className="flex items-center justify-between gap-3 px-4 pt-3 sm:px-5">
              <UnderlineTabs label="Builder views" idPrefix="builder" size="sm" value={leftView} onChange={setView} tabs={tabs} className="flex-1" />
            </div>
            <div id="builder-panel" role="tabpanel" aria-labelledby={`builder-tab-${leftView}`} className="flex min-h-0 flex-1 flex-col">
              {leftView === "edit" ? (
                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-5">
                  <SectionEditor doc={doc} onChange={edit} />
                </div>
              ) : (
                <ChatPanel
                  messages={messages}
                  nextPrompts={nextPrompts}
                  busy={chatBusy}
                  importing={importing}
                  disabled={quota.exhausted}
                  disabledReason={quota.exhausted ? "Monthly runs used up. Editing, preview and downloads still work." : undefined}
                  onSend={send}
                  onImport={(f) => void importFile(f)}
                />
              )}
            </div>
            {!quota.exhausted ? <QuotaNotice quota={quota} className="border-t border-border px-4 py-2 sm:px-5" /> : null}
          </div>
        ) : null}

        {showRight ? (
          <div className={cn("min-h-0 overflow-y-auto bg-ground-2/40 px-4 py-5 sm:px-8")} data-testid="builder-preview">
            {mobile ? (
              <div className="mb-3">
                <TemplateChooser value={templateId} onChange={setTemplateId} />
              </div>
            ) : null}
            <div className="mx-auto max-w-[680px]">
              {loadingDraft ? (
                <p role="status" className="text-[13px] text-muted-foreground">
                  Opening the draft
                </p>
              ) : null}
              <PreviewFrame html={content ? preview.html : null} busy={preview.busy} error={preview.error} title={`Preview of ${documentTitle(doc)}`} />
              {!content ? <p className="mt-3 text-center text-[13px] text-muted-foreground">Your resume appears here as you talk.</p> : null}
            </div>
          </div>
        ) : null}
      </div>

      <DraftsDrawer
        open={drawer}
        onOpenChange={setDrawer}
        currentId={draftId}
        onOpen={openDraft}
        onDeleted={(id) => {
          if (id === draftId) fresh();
        }}
      />
      <ConfirmDialog
        open={!!pendingOpen}
        onOpenChange={(o) => !o && setPendingOpen(null)}
        destructive
        title="Discard unsaved changes?"
        description="Opening another draft replaces what is on screen. Save first to keep it."
        confirmLabel="Discard and open"
        cancelLabel="Keep editing"
        onConfirm={() => {
          if (pendingOpen) router.push(`/builder?draft=${encodeURIComponent(pendingOpen)}`);
        }}
      />
    </div>
  );
}
