"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import { ArrowUp, Paperclip } from "lucide-react";
import type { BuilderMessage } from "@open-resume/types";
import { cn, IconButton, Textarea } from "@open-resume/ui";
import { SimpleText } from "../simple-text";
import { ACCEPT_ATTR } from "@/lib/resume/upload-validation";

export const WELCOME: BuilderMessage = {
  role: "assistant",
  content: "Tell me about yourself and I will build the resume as we talk: your latest role, your education, what you are good at. You can also paste an existing resume or drop a file here.",
};

export function ChatPanel({
  messages,
  nextPrompts,
  busy,
  importing,
  disabled,
  disabledReason,
  onSend,
  onImport,
}: {
  messages: BuilderMessage[];
  nextPrompts: string[];
  busy: boolean;
  importing: boolean;
  /** Sending is blocked (monthly runs used up); editing and downloading still work. */
  disabled?: boolean;
  disabledReason?: string;
  onSend: (text: string) => Promise<boolean>;
  onImport: (file: File) => void;
}) {
  const [text, setText] = useState("");
  const [over, setOver] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const waiting = busy || importing;

  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end" });
  }, [messages.length, waiting]);
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  const send = async () => {
    const t = text.trim();
    if (!t || waiting || disabled) return;
    setText("");
    if (!(await onSend(t))) setText(t);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f && !waiting && !disabled) onImport(f);
  };

  return (
    <div
      className={cn("flex min-h-0 flex-1 flex-col", over && "bg-muted/60")}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <div role="log" aria-live="polite" aria-label="Conversation" data-testid="chat-log" className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
        <ul className="space-y-6">
          {messages.map((m, i) => (
            <li key={i} data-testid={`chat-${m.role}`}>
              <p className="mb-1 text-[12.5px] font-medium text-subtle-foreground">{m.role === "user" ? "You" : "Assistant"}</p>
              {m.role === "assistant" ? <SimpleText className="text-[15px] leading-[1.65] [&>*:first-child]:mt-0">{m.content}</SimpleText> : <p className="whitespace-pre-wrap text-[15px] leading-[1.65]">{m.content}</p>}
            </li>
          ))}
          {waiting ? (
            <li role="status" className="text-[13.5px] text-muted-foreground" data-testid="chat-working">
              {importing ? "Reading your file" : "Working on it"}
            </li>
          ) : null}
        </ul>
        <div ref={end} />
      </div>

      <div className="border-t border-border px-4 pb-4 pt-3 sm:px-5">
        {nextPrompts.length && !waiting ? (
          <ul aria-label="Suggestions" className="mb-3 flex flex-col items-start gap-1">
            {nextPrompts.slice(0, 4).map((p) => (
              <li key={p}>
                <button
                  type="button"
                  className="text-left text-[13.5px] text-link underline-offset-4 hover:underline"
                  onClick={() => {
                    setText(p);
                    area.current?.focus();
                  }}
                >
                  {p}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {disabled && disabledReason ? (
          <p role="status" className="mb-2 text-[13px] font-medium text-danger">
            {disabledReason}
          </p>
        ) : null}
        <div className="flex items-end gap-1 rounded-card border border-input bg-card px-2 py-1.5 focus-within:ring-2 focus-within:ring-ring/40">
          <input
            ref={file}
            type="file"
            accept={ACCEPT_ATTR}
            className="sr-only"
            aria-label="Import a resume file"
            data-testid="builder-file-input"
            tabIndex={-1}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) onImport(f);
            }}
          />
          <IconButton label="Import a resume file" size="sm" disabled={waiting || disabled} onClick={() => file.current?.click()}>
            <Paperclip />
          </IconButton>
          <Textarea
            ref={area}
            rows={1}
            value={text}
            aria-label="Message"
            data-testid="chat-input"
            placeholder="Describe your experience, or paste your resume"
            maxLength={32000}
            disabled={disabled}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
            className="min-h-0 flex-1 resize-none border-0 bg-transparent px-1 py-1.5 shadow-none focus-visible:ring-0"
          />
          <IconButton label="Send message" variant="primary" size="sm" disabled={!text.trim() || waiting || disabled} onClick={() => void send()} data-testid="chat-send">
            <ArrowUp />
          </IconButton>
        </div>
      </div>
    </div>
  );
}
