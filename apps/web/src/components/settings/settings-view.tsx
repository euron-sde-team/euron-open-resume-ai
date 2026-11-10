"use client";

/** Settings: appearance and this month's use, and the account (profile, security, privacy). */
import { useState } from "react";
import { Menu } from "lucide-react";
import { Button, cn, Input, NativeSelect, toast } from "@open-resume/ui";
import { PrivacySection } from "@/components/account/privacy-section";
import { SecuritySection } from "@/components/account/security-section";
import { useShell } from "@/components/app/shell-context";
import { api } from "@/lib/api";
import { useAuth, useMe } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { useUsage } from "@/lib/queries";
import { useTheme, type ThemePref } from "@/lib/stores/theme";

type Tab = "general" | "account";
const TABS: { id: Tab; label: string }[] = [
  { id: "general", label: "General" },
  { id: "account", label: "Account" },
];

function Row({ title, description, children }: { title: string; description?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-b border-border py-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-[14.5px] font-medium">{title}</p>
        {description ? <p className="mt-0.5 max-w-md text-[13.5px] text-muted-foreground">{description}</p> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function General() {
  const { pref, setPref } = useTheme();
  const usage = useUsage();
  const u = usage.data;
  return (
    <div>
      <Row title="Theme">
        <NativeSelect aria-label="Theme" value={pref} onChange={(e) => setPref(e.target.value as ThemePref)} className="w-40">
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </NativeSelect>
      </Row>
      {u ? (
        <Row title="AI runs this month" description={`Resets on ${new Date(u.resetsAt).toLocaleDateString(undefined, { month: "long", day: "numeric" })}.`}>
          <p data-testid="usage-runs" className="text-right text-[13.5px] tabular-nums">
            {u.runs.limit === null ? `${u.runs.used} runs` : `${u.runs.used} of ${u.runs.limit} runs`}
          </p>
        </Row>
      ) : null}
    </div>
  );
}

function Profile() {
  const me = useMe();
  const { setUser } = useAuth();
  const [name, setName] = useState(me.displayName);
  const [busy, setBusy] = useState(false);
  const saveName = async () => {
    setBusy(true);
    try {
      setUser(await api().users.updateMe({ displayName: name }));
      toast.success({ title: "Saved" });
    } catch (err) {
      toast.error({ title: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="border-b border-border py-6">
      <p className="text-[13px] text-muted-foreground">{me.email}</p>
      <div className="mt-2 flex gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} aria-label="Name" className="max-w-xs" />
        <Button variant="secondary" disabled={!name.trim() || name === me.displayName} loading={busy} onClick={() => void saveName()}>
          Save
        </Button>
      </div>
    </div>
  );
}

export function SettingsView() {
  const shell = useShell();
  const [tab, setTab] = useState<Tab>("general");
  return (
    <div className="h-full overflow-y-auto">
      <header className="flex h-14 items-center gap-1 px-2 sm:px-3">
        {shell.collapsed || shell.mobile ? (
          <button type="button" aria-label="Open sidebar" onClick={shell.open} className="inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted">
            <Menu className="size-5" />
          </button>
        ) : null}
      </header>
      <div className="mx-auto w-full max-w-[860px] px-4 pb-20 sm:px-6">
        <h1 className="font-display text-[30px] font-semibold tracking-[-0.02em]">Settings</h1>
        <div className="mt-6 flex gap-5 overflow-x-auto border-b border-border" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={cn("-mb-px shrink-0 border-b-2 pb-2.5 text-[14.5px] font-medium transition-colors", tab === t.id ? "border-ink text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
              {t.label}
            </button>
          ))}
        </div>
        <div role="tabpanel" className="mt-2">
          {tab === "general" ? <General /> : null}
          {tab === "account" ? (
            <div>
              <Profile />
              <div className="pt-6">
                <SecuritySection />
              </div>
              <div className="pt-10">
                <PrivacySection />
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
