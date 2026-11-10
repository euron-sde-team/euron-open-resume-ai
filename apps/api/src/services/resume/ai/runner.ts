/**
 * The structured-output runner: ask a model for one JSON object, extract it (fences,
 * surrounding prose), validate it with zod, and on a bad answer ask exactly once more with
 * the validation errors fed back. Token usage is accumulated on the caller's accumulator.
 *
 * Errors are user-safe on purpose (nothing from the provider or the model's text):
 *   AiUnavailable  the model could not be reached, timed out, refused, or was cancelled;
 *   AiBadOutput    two answers in a row did not validate.
 * Callers map them to HTTP errors (see builder-ai.controller.ts) or job failures.
 */
import type { ZodTypeAny, z } from "zod";
import { logger } from "../../../core/logger";
import { completeText, type LlmMessage } from "../../../integrations/llm";
import { ProviderError } from "../../../integrations/http";
import { resolveTextModel, type ResolvedModel } from "../../models.service";
import type { AiContext } from "../ai-tasks";
import type { Prompt } from "./prompts";

export class AiUnavailable extends Error {
  readonly code = "AI_UNAVAILABLE";
  constructor(message = "The AI service is not available right now. Please try again in a moment.") {
    super(message);
    this.name = "AiUnavailable";
  }
}

export class AiBadOutput extends Error {
  readonly code = "AI_BAD_OUTPUT";
  constructor(message = "The AI returned an answer we could not use. Please try again.") {
    super(message);
    this.name = "AiBadOutput";
  }
}

export interface UsageAcc {
  inputTokens: number;
  outputTokens: number;
  offline: boolean;
  calls: number;
}

export const newUsage = (offline = false): UsageAcc => ({ inputTokens: 0, outputTokens: 0, offline, calls: 0 });

export interface RunCtx {
  ai: AiContext;
  usage: UsageAcc;
  /** Resolved once per task by the caller; resolved here when absent. */
  model?: ResolvedModel;
  /** Hard wall-clock limit across both attempts. Default 120 s. */
  timeoutMs?: number;
  /** Label for logs only (never any text). */
  task?: string;
}

export const TIMEOUT_MS = { chat: 90_000, default: 120_000 } as const;

// ─── JSON extraction ────────────────────────────────────────────────────────

/** The first balanced {...} object in `s` (string and escape aware), or null. */
export function firstBalancedObject(s: string): string | null {
  for (let start = s.indexOf("{"); start !== -1; start = s.indexOf("{", start + 1)) {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < s.length; i++) {
      const c = s[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

/** Recover a JSON object from a model answer: plain, fenced, or buried in prose. */
export function extractJson(raw: string): unknown | undefined {
  const tryParse = (t: string): unknown | undefined => {
    try {
      const v: unknown = JSON.parse(t);
      return v && typeof v === "object" ? v : undefined;
    } catch {
      return undefined;
    }
  };
  const trimmed = raw.trim();
  const direct = tryParse(trimmed);
  if (direct !== undefined) return direct;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenced?.[1]) {
    const v = tryParse(fenced[1].trim());
    if (v !== undefined) return v;
  }
  const stripped = trimmed.replace(/```(?:json)?/gi, "");
  const block = firstBalancedObject(stripped);
  return block ? tryParse(block) : undefined;
}

function describeIssues(err: z.ZodError): string {
  return err.issues
    .slice(0, 12)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("\n");
}

// ─── The runner ─────────────────────────────────────────────────────────────

export async function runStructured<S extends ZodTypeAny>(schema: S, prompt: Prompt, run: RunCtx): Promise<z.output<S>> {
  const model = run.model ?? (await resolveTextModel(run.ai.modelId));
  if (!model) throw new AiUnavailable("No AI model is configured.");
  const timeoutMs = run.timeoutMs ?? TIMEOUT_MS.default;
  const deadline = Date.now() + timeoutMs;
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = run.ai.signal ? AbortSignal.any([run.ai.signal, timeout]) : timeout;
  const maxOut = Math.max(512, Math.min(prompt.maxOutputTokens, model.model.max_output_tokens || prompt.maxOutputTokens));

  const messages: LlmMessage[] = [
    { role: "system", content: prompt.system },
    { role: "user", content: [{ type: "text", text: prompt.user }] },
  ];

  let lastFeedback = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    if (Date.now() >= deadline) throw new AiUnavailable("The AI took too long to answer. Please try again.");
    let result: Awaited<ReturnType<typeof completeText>>;
    try {
      result = await raceAbort(completeText({ model: model.model.model_ref, messages, maxOutputTokens: maxOut, temperature: attempt === 0 ? 0.3 : 0.1, json: true, signal }, model.endpoint, model.adapter), signal);
    } catch (err) {
      throw mapProviderError(err, run, timeout, signal);
    }
    run.usage.inputTokens += result.inputTokens;
    run.usage.outputTokens += result.outputTokens;
    run.usage.calls += 1;

    const json = extractJson(result.text);
    if (json === undefined) {
      lastFeedback = result.finish === "length" ? "Your answer was cut off before the JSON object was complete. Answer again with the complete JSON object only, more concisely." : "Your answer did not contain a JSON object. Answer with the JSON object only.";
    } else {
      const parsed = schema.safeParse(json);
      if (parsed.success) return parsed.data as z.output<S>;
      lastFeedback = `Your JSON did not match the required shape:\n${describeIssues(parsed.error)}\nAnswer again with the corrected complete JSON object only.`;
    }
    logger.info({ task: run.task, attempt: attempt + 1, finish: result.finish }, "structured answer rejected");
    messages.push({ role: "assistant", content: result.text.slice(0, 12_000) }, { role: "user", content: [{ type: "text", text: lastFeedback }] });
  }
  throw new AiBadOutput();
}

/** Settle when the signal fires even if an adapter ignores it. */
function raceAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error("aborted"));
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason ?? new Error("aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  return Promise.race([work, aborted]).finally(() => {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  });
}

function mapProviderError(err: unknown, run: RunCtx, timeout: AbortSignal, signal: AbortSignal): Error {
  if (err instanceof AiUnavailable || err instanceof AiBadOutput) return err;
  if (timeout.aborted) return new AiUnavailable("The AI took too long to answer. Please try again.");
  if (run.ai.signal?.aborted || signal.aborted) return new AiUnavailable("The request was cancelled.");
  if (err instanceof ProviderError) {
    logger.warn({ task: run.task, failure: err.failure, status: err.status }, "model call failed");
    if (err.failure === "CONTEXT_TOO_LONG") return new AiUnavailable("This resume is too long for the AI model. Shorten it and try again.");
    if (err.failure === "RATE_LIMITED") return new AiUnavailable("The AI service is busy right now. Please try again in a minute.");
    return new AiUnavailable();
  }
  logger.warn({ task: run.task, err: err instanceof Error ? err.message : "unknown" }, "model call failed");
  return new AiUnavailable();
}
