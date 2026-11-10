"use client";

import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { Button, Field, Input, Select, Skeleton, Textarea, toast } from "@open-resume/ui";
import type { AppSettings } from "@open-resume/types";
import { api } from "@/lib/api";
import { adminErrorMessage, dirtyGroups, parseDomains, settingsErrors, settingsPatch, type SettingsGroup } from "@/lib/admin";
import { qk } from "@/lib/query-keys";
import { ErrorState } from "@/components/common/states";
import { AdminPage, AdminSection, FactList, StatusText } from "../shell";
import { adminMutation, ak } from "./common";

/** The form's text fields, kept as typed (an empty box means null). */
interface Form extends Omit<AppSettings, "supportEmail" | "minSupportedVersion"> {
  supportEmail: string;
  minSupportedVersion: string;
}

export const toForm = (s: AppSettings): Form => ({ ...s, supportEmail: s.supportEmail ?? "", minSupportedVersion: s.minSupportedVersion ?? "" });

export const fromForm = (f: Form): AppSettings => ({
  ...f,
  supportEmail: f.supportEmail.trim() || null,
  minSupportedVersion: f.minSupportedVersion.trim() || null,
});

const GROUP_LABEL: Record<SettingsGroup, string> = { general: "General", signup: "Sign-up", assistant: "AI", mobile: "Mobile" };

export function AdminSettings() {
  const q = useQuery({ queryKey: ak.settings, queryFn: () => api().admin.settings() });
  return (
    <AdminPage title="Settings" description="How this deployment behaves for everyone. Changes apply right away and are recorded in the audit log." testId="admin-settings">
      {q.isError && !q.data ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : q.data ? <SettingsForm saved={q.data} /> : <FormSkeleton />}
      <Integrations />
    </AdminPage>
  );
}

function SettingsForm({ saved }: { saved: AppSettings }) {
  const id = useId();
  const qc = useQueryClient();
  const [form, setForm] = useState<Form>(() => toForm(saved));
  const [domainText, setDomainText] = useState("");
  const [domainError, setDomainError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A save (or a refetch) replaces the baseline; the draft follows it.
  useEffect(() => setForm(toForm(saved)), [saved]);

  const draft = useMemo(() => fromForm(form), [form]);
  const errs = settingsErrors(draft);
  const dirty = dirtyGroups(saved, draft);
  const valid = Object.keys(errs).length === 0;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: () => api().admin.updateSettings(settingsPatch(saved, draft)),
    ...adminMutation({ inline: true }),
    onMutate: () => setError(null),
    onError: (e) => setError(adminErrorMessage(e)),
    onSuccess: (next) => {
      qc.setQueryData(ak.settings, next);
      void qc.invalidateQueries({ queryKey: qk.meta });
      toast.success({ title: "Settings saved" });
    },
  });

  const addDomains = () => {
    const { added, invalid } = parseDomains(domainText, form.allowedEmailDomains);
    if (added.length) set("allowedEmailDomains", [...form.allowedEmailDomains, ...added]);
    setDomainError(invalid.length ? `Not a domain: ${invalid.join(", ")}` : null);
    setDomainText(invalid.join(" "));
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (valid && dirty.length) save.mutate();
      }}
      data-testid="settings-form"
    >
      <AdminSection title="General" id="general">
        <div className="grid max-w-2xl gap-4">
          <Field label="App name" htmlFor={`${id}-name`} error={errs.appName} hint="Shown in the header, page titles and emails.">
            <Input id={`${id}-name`} value={form.appName} maxLength={60} onChange={(e) => set("appName", e.target.value)} data-testid="settings-app-name" />
          </Field>
          <Field label="Tagline" htmlFor={`${id}-tagline`} optional error={errs.tagline}>
            <Input id={`${id}-tagline`} value={form.tagline} maxLength={160} onChange={(e) => set("tagline", e.target.value)} data-testid="settings-tagline" />
          </Field>
          <Field label="Support email" htmlFor={`${id}-support`} optional error={errs.supportEmail} hint="Where people can write for help.">
            <Input id={`${id}-support`} type="email" value={form.supportEmail} maxLength={200} onChange={(e) => set("supportEmail", e.target.value)} data-testid="settings-support-email" />
          </Field>
        </div>
      </AdminSection>

      <AdminSection title="Sign-up" id="signup">
        <div className="grid max-w-2xl gap-4">
          <Field label="Who can create an account" htmlFor={`${id}-reg`}>
            <Select
              id={`${id}-reg`}
              value={form.registration}
              onValueChange={(v) => set("registration", v as AppSettings["registration"])}
              options={[
                { value: "OPEN", label: "Anyone" },
                { value: "INVITE_ONLY", label: "Only people with an allowed email domain" },
                { value: "CLOSED", label: "No one: sign-up is closed" },
              ]}
              data-testid="settings-registration"
            />
          </Field>
          <Field
            label="Allowed email domains"
            htmlFor={`${id}-domains`}
            optional={form.registration !== "INVITE_ONLY"}
            error={domainError ?? errs.allowedEmailDomains}
            hint={form.registration === "INVITE_ONLY" ? "Only addresses at these domains can sign up." : "Used when sign-up is limited to allowed domains."}
          >
            <div className="flex gap-2">
              <Input
                id={`${id}-domains`}
                value={domainText}
                placeholder="example.com"
                onChange={(e) => setDomainText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addDomains();
                  }
                }}
                data-testid="settings-domain-input"
              />
              <Button type="button" variant="outline" onClick={addDomains} disabled={!domainText.trim()} data-testid="settings-domain-add">
                Add
              </Button>
            </div>
          </Field>
          {form.allowedEmailDomains.length ? (
            <ul className="divide-y divide-border border-y border-border" aria-label="Allowed email domains" data-testid="settings-domains">
              {form.allowedEmailDomains.map((d) => (
                <li key={d} className="flex items-center justify-between gap-3 py-2 text-[14px]">
                  <span className="min-w-0 break-all font-mono text-[13px]">{d}</span>
                  <button
                    type="button"
                    onClick={() => set("allowedEmailDomains", form.allowedEmailDomains.filter((x) => x !== d))}
                    className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={`Remove ${d}`}
                  >
                    <X className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </AdminSection>

      <AdminSection title="AI" id="assistant">
        <div className="grid max-w-2xl gap-4">
          <Field
            label="House instructions"
            htmlFor={`${id}-prompt`}
            optional
            error={errs.systemPromptAddendum}
            hint={`Added to every AI request, for everyone. ${form.systemPromptAddendum.length} of 4,000 characters.`}
          >
            <Textarea id={`${id}-prompt`} rows={6} value={form.systemPromptAddendum} onChange={(e) => set("systemPromptAddendum", e.target.value)} placeholder="For example: write in British English." data-testid="settings-prompt" />
          </Field>
        </div>
      </AdminSection>

      <AdminSection title="Mobile" id="mobile">
        <div className="max-w-2xl">
          <Field label="Minimum supported app version" htmlFor={`${id}-ver`} optional error={errs.minSupportedVersion} hint="Older mobile apps are asked to update. Leave empty to allow every version.">
            <Input id={`${id}-ver`} value={form.minSupportedVersion} placeholder="1.4.0" onChange={(e) => set("minSupportedVersion", e.target.value)} className="w-40 font-mono" data-testid="settings-min-version" />
          </Field>
        </div>
      </AdminSection>

      {dirty.length || error ? (
        <div className="sticky bottom-0 z-30 -mx-4 mt-8 border-t border-border bg-background/90 backdrop-blur-xl sm:-mx-6" data-testid="settings-save-bar">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <p className="min-w-0 text-[13.5px]" aria-live="polite">
              {error ? (
                <span role="alert" className="font-medium text-danger">
                  {error}
                </span>
              ) : (
                <span className="text-muted-foreground">Unsaved changes in {listJoin(dirty.map((g) => GROUP_LABEL[g]))}.</span>
              )}
            </p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setForm(toForm(saved));
                  setError(null);
                  setDomainError(null);
                  setDomainText("");
                }}
                disabled={save.isPending}
                data-testid="settings-discard"
              >
                Discard
              </Button>
              <Button type="submit" disabled={!valid || !dirty.length} loading={save.isPending} data-testid="settings-save">
                Save changes
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </form>
  );
}

const listJoin = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

function Integrations() {
  const q = useQuery({ queryKey: ak.integrations, queryFn: () => api().admin.integrations(), staleTime: 5 * 60_000 });
  const i = q.data;
  const on = (v: boolean, yes: ReactNode = "Configured", no: ReactNode = "Not configured") => (v ? <StatusText tone="success">{yes}</StatusText> : <StatusText tone="muted">{no}</StatusText>);
  return (
    <AdminSection title="Integrations" id="integrations" description="What the server is set up with, from its environment. Change these in the server's configuration and restart it.">
      {q.isError && !i ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} compact />
      ) : !i ? (
        <div className="max-w-2xl space-y-2" aria-busy>
          {Array.from({ length: 5 }, (_, n) => (
            <Skeleton key={n} className="h-5 w-2/3" />
          ))}
        </div>
      ) : (
        <FactList
          className="max-w-2xl"
          items={[
            { label: "AI provider", value: on(i.ai.providerConfigured, "Configured", "None: the offline engine answers") },
            { label: "Email", value: i.mail.mode === "outbox" ? "Outbox: written to disk on the server, not sent" : i.mail.mode === "smtp" ? "SMTP" : "Amazon SES" },
            { label: "File storage", value: i.storage.mode === "local" ? "Local disk" : "S3" },
          ]}
        />
      )}
    </AdminSection>
  );
}

function FormSkeleton() {
  return (
    <div className="max-w-2xl space-y-6 border-t border-border pt-6" aria-busy>
      {Array.from({ length: 4 }, (_, n) => (
        <div key={n} className="space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-10 w-full" />
        </div>
      ))}
    </div>
  );
}
