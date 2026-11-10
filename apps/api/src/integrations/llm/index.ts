/** The adapter for each provider kind, and each kind's default endpoint. */
import type { ProviderKind } from "@open-resume/types";
import { config } from "../../core/config";
import { anthropic } from "./anthropic";
import { gemini } from "./gemini";
import { openAiChat } from "./openai-chat";
import type { Endpoint, LlmAdapter, LlmRequest } from "./types";

const ADAPTERS: Record<ProviderKind, LlmAdapter> = {
  OPENAI: openAiChat({ maxTokensField: "max_completion_tokens" }),
  OPENAI_COMPATIBLE: openAiChat({ maxTokensField: "max_tokens" }),
  STUB: openAiChat({ maxTokensField: "max_tokens" }),
  ANTHROPIC: anthropic,
  GEMINI: gemini,
};

let override: LlmAdapter | null = null;

/** Tests: route every call through a fake adapter (null restores the real ones). */
export function setLlmAdapterForTests(a: LlmAdapter | null): void {
  override = a;
}

export function adapterFor(kind: ProviderKind): LlmAdapter {
  return override ?? ADAPTERS[kind];
}

/** Where a provider kind lives when the admin left base_url empty. */
export function defaultBaseUrl(kind: ProviderKind): string | null {
  switch (kind) {
    case "OPENAI":
      return "https://api.openai.com/v1";
    case "ANTHROPIC":
      return "https://api.anthropic.com";
    case "GEMINI":
      return "https://generativelanguage.googleapis.com/v1beta";
    case "STUB":
      return `${config.STUBS_URL.replace(/\/$/, "")}/v1`;
    case "OPENAI_COMPATIBLE":
      return null;
  }
}

export type { Endpoint, LlmAdapter, LlmEvent, LlmMessage, LlmPart, LlmRequest, LlmTool, LlmToolCall } from "./types";

/** Run a request to completion and return the whole answer text with the token counts. */
export async function completeText(req: LlmRequest, endpoint: Endpoint, adapter: LlmAdapter): Promise<{ text: string; inputTokens: number; outputTokens: number; finish: string }> {
  let text = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let finish = "stop";
  for await (const ev of adapter.stream(req, endpoint)) {
    if (ev.type === "text") text += ev.text;
    else if (ev.type === "usage") {
      inputTokens = ev.inputTokens;
      outputTokens = ev.outputTokens;
    } else if (ev.type === "finish") finish = ev.reason;
  }
  return { text, inputTokens, outputTokens, finish };
}
