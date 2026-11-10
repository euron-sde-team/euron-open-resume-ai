"use client";

/** Queries of the app shell: this month's usage and your preferences. */
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { qk } from "./query-keys";

export function useUsage() {
  return useQuery({ queryKey: qk.usage, queryFn: () => api().me.usage(), staleTime: 30_000, meta: { silent: true } });
}

export function usePreferences() {
  return useQuery({ queryKey: qk.preferences, queryFn: () => api().me.preferences(), staleTime: 60_000 });
}
