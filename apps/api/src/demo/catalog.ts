/**
 * A starter model catalogue: the providers most people use, with a few current models
 * each, so a new install only needs keys. Model ids change often: edit them in
 * /admin/models (the "Test" button checks one in a second). A provider without a key is
 * simply not offered (services/models.service.ts), so nothing here is visible until its
 * key is set; with no key at all the resume tasks run on the offline engine. The stub
 * provider is added by `demo:seed` outside production only.
 */
import { config } from "../core/config";
import { newId } from "../core/ids";
import type { Executor } from "../db/kysely";

interface StarterModel {
  ref: string;
  name: string;
  description: string;
  context?: number;
  maxOut?: number;
  isDefault?: boolean;
}

type StarterProvider = { id: string; kind: "OPENAI" | "ANTHROPIC" | "GEMINI" | "OPENAI_COMPATIBLE" | "STUB"; name: string; baseUrl: string | null; models: StarterModel[] };

const PROVIDERS: StarterProvider[] = [
  {
    id: "openai",
    kind: "OPENAI",
    name: "OpenAI",
    baseUrl: null,
    models: [
      { ref: "gpt-5.4-mini", name: "GPT-5.4 mini", description: "Fast and capable for everyday work.", context: 400000, maxOut: 16000, isDefault: true },
      { ref: "gpt-5.4", name: "GPT-5.4", description: "OpenAI's strongest general model.", context: 400000, maxOut: 32000 },
    ],
  },
  {
    id: "anthropic",
    kind: "ANTHROPIC",
    name: "Anthropic",
    baseUrl: null,
    models: [
      { ref: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", description: "Thoughtful writing and analysis.", context: 200000, maxOut: 16000 },
      { ref: "claude-haiku-5-5", name: "Claude Haiku 5.5", description: "Quick answers at low cost.", context: 200000, maxOut: 8000 },
    ],
  },
  {
    id: "gemini",
    kind: "GEMINI",
    name: "Google Gemini",
    baseUrl: null,
    models: [{ ref: "gemini-3.5-flash", name: "Gemini 3.5 Flash", description: "Fast model with a long context.", context: 1000000, maxOut: 16000 }],
  },
];

const STUB: StarterProvider = {
  id: "stub",
  kind: "STUB",
  name: "Local stub",
  baseUrl: null,
  models: [{ ref: "stub-text", name: "Stub", description: "Deterministic local model (apps/stubs).", context: 128000, maxOut: 4096, isDefault: true }],
};

/** Insert the starter catalogue where it is missing. Returns the stub model id when the stub was added. */
export async function ensureStarterCatalog(exec: Executor, opts: { includeStub?: boolean; stubIsDefault?: boolean } = {}): Promise<{ stub: string } | null> {
  const list = opts.includeStub && config.NODE_ENV !== "production" ? [STUB, ...PROVIDERS] : PROVIDERS;
  let order = 0;
  const ids: Record<string, string> = {};
  for (const p of list) {
    await exec.insertInto("providers").values({ id: p.id, kind: p.kind, display_name: p.name, base_url: p.baseUrl, enabled: !(p.kind === "STUB" && opts.stubIsDefault === false) }).onConflict((oc) => oc.column("id").doNothing()).execute();
    for (const m of p.models) {
      const existing = await exec.selectFrom("models").select("id").where("provider_id", "=", p.id).where("model_ref", "=", m.ref).where("kind", "=", "TEXT").executeTakeFirst();
      const id = existing?.id ?? newId();
      if (!existing) {
        // The first default wins: the stub (tests) is listed first, so it leads when present.
        const hasDefault = await exec.selectFrom("models").select("id").where("kind", "=", "TEXT").where("is_default", "=", true).executeTakeFirst();
        await exec
          .insertInto("models")
          .values({
            id,
            provider_id: p.id,
            kind: "TEXT",
            model_ref: m.ref,
            display_name: m.name,
            description: m.description,
            context_window: m.context ?? 128000,
            max_output_tokens: m.maxOut ?? 4096,
            enabled: true,
            is_default: !!m.isDefault && !hasDefault && !(p.kind === "STUB" && opts.stubIsDefault === false),
            sort_order: order++,
          })
          .execute();
      }
      ids[`${p.id}:${m.ref}`] = id;
    }
  }
  return ids["stub:stub-text"] ? { stub: ids["stub:stub-text"]! } : null;
}
