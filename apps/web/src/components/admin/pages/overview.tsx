"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AdminStats } from "@open-resume/types";
import { api } from "@/lib/api";
import { RANGE_PRESETS, formatCount, parsePreset, presetRange, type RangePreset } from "@/lib/admin";
import { qk } from "@/lib/query-keys";
import { ErrorState } from "@/components/common/states";
import { UnderlineTabs } from "@/components/common/underline-tabs";
import { AdminPage, AdminSection, Chart, DataTable, StatLine, useUrlState, type Column, type StatItem } from "../shell";

type KindRow = AdminStats["byKind"][number];

export function AdminOverview() {
  const url = useUrlState();
  const preset = parsePreset(url.get("range"));
  const range = useMemo(() => presetRange(preset), [preset]);
  const q = useQuery({
    queryKey: qk.admin.list("stats", range),
    queryFn: () => api().admin.stats(range),
    placeholderData: (p) => p,
  });
  const s = q.data;

  return (
    <AdminPage
      title="Overview"
      description="Accounts and usage across the deployment. Days are counted in UTC."
      filters={
        <UnderlineTabs<`${RangePreset}`>
          tabs={RANGE_PRESETS.map((d) => ({ value: `${d}` as const, label: `Last ${d} days` }))}
          value={`${preset}`}
          onChange={(v) => url.set({ range: v === "30" ? null : v })}
          label="Date range"
        />
      }
      testId="admin-overview"
    >
      {q.isError && !s ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <div className={q.isPlaceholderData ? "opacity-60 transition-opacity" : "transition-opacity"}>
          <StatLine loading={!s} size="lg" items={totals(s)} testId="overview-totals" />
          <AdminSection title="Sign-ups by day" id="daily" className="mt-10">
            {s ? (
              <Chart
                data={s.daily}
                series={[
                  { key: "newUsers", label: "New users", tone: "primary" },
                ]}
                title="New users per day"
                testId="overview-chart"
              />
            ) : (
              <div className="h-[240px] animate-shimmer rounded-md bg-muted" aria-hidden />
            )}
          </AdminSection>
          <ByKind stats={s} />
        </div>
      )}
    </AdminPage>
  );
}

function totals(s: AdminStats | undefined): StatItem[] {
  const t = s?.totals;
  const v = (x: number | undefined) => (x === undefined ? "" : formatCount(x));
  return [
    { label: "Users", value: v(t?.users), testId: "stat-users" },
    { label: "Active users", value: v(t?.activeUsers), testId: "stat-active" },
    { label: "New users", value: v(t?.newUsers), testId: "stat-new" },
    { label: "AI runs", value: v(t?.runs), testId: "stat-runs" },
  ];
}

function ByKind({ stats }: { stats: AdminStats | undefined }) {
  const columns = useMemo<Column<KindRow>[]>(
    () => [
      { key: "kind", header: "Kind of run", cell: (r) => <span className="font-medium text-foreground">{r.kind}</span>, sortValue: (r) => r.kind },
      { key: "runs", header: "Runs", align: "right", cell: (r) => formatCount(r.runs), sortValue: (r) => r.runs },
    ],
    [],
  );
  return (
    <AdminSection title="AI runs by kind" description="Counted per calendar month; the range covers every month it touches." id="by-kind" className="mt-10">
      <DataTable caption="AI runs by kind" rows={stats?.byKind ?? []} columns={columns} rowKey={(r) => r.kind} loading={!stats} skeletonRows={4} empty={{ title: "No AI runs in this range." }} testId="overview-by-kind" />
    </AdminSection>
  );
}
