/**
 * useLivePace — overlays today's intraday cumulative on the cohort baselines
 * produced by useActivityProfiles, then surfaces per-agent live pace status
 * + an org-wide rollup.
 *
 * Refresh model: this hook re-fetches intraday whenever DataContext fires a
 * realtime event (Tier 1) by reading `lastUpdatedAt` and using it as the
 * useEffect dependency. The cohort baselines themselves only refresh on the
 * 30-day window — they don't move minute-to-minute.
 */

import { useEffect, useMemo, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useActivityProfiles } from "@/hooks/useActivityProfiles";
import { useData } from "@/contexts/DataContext";
import {
  buildAgentLiveSummary,
  getCentralHour,
  paceFraction,
  summarizeOrgPulse,
  type AgentIntradayCumulative,
  type AgentLiveSummary,
  type OrgLivePulse,
} from "@/lib/livePace";

interface IntradayRow {
  agent_name: string;
  scrape_hour: number;
  total_dials: number | null;
  talk_time_minutes: number | null;
  pool_dials: number | null;
  pool_talk_minutes: number | null;
  pool_long_calls: number | null;
  pool_self_assigned: number | null;
}

export interface UseLivePaceResult {
  loading: boolean;
  error: string | null;
  /** Central-time hour of the freshest intraday row (or current hour if 0 rows). */
  hour: number;
  /** Pace curve fraction at `hour` (0 if before 9 AM). */
  paceFraction: number;
  /** Per-agent live summaries — only includes agents with intraday rows today. */
  agents: AgentLiveSummary[];
  /** Org-wide rollup. */
  pulse: OrgLivePulse;
  /** Today's date (YYYY-MM-DD, Central). */
  scrapeDate: string;
}

function todayCentral(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

export function useLivePace(windowDays = 30): UseLivePaceResult {
  const { profiles, baselines, loading: baselinesLoading } = useActivityProfiles(windowDays);
  const { lastUpdatedAt } = useData();

  const [intradayRows, setIntradayRows] = useState<IntradayRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scrapeDate = useMemo(() => todayCentral(), []);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    supabase
      .from("intraday_snapshots")
      .select("agent_name, scrape_hour, total_dials, talk_time_minutes, pool_dials, pool_talk_minutes, pool_long_calls, pool_self_assigned")
      .eq("scrape_date", scrapeDate)
      .then(({ data, error: err }) => {
        if (cancelled) return;
        if (err) {
          setError(err.message);
          setIntradayRows([]);
        } else {
          setIntradayRows((data ?? []) as IntradayRow[]);
        }
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // lastUpdatedAt is the realtime trigger — when DataContext signals new
    // intraday data, this re-runs and we re-fetch. baselines change much
    // less frequently and aren't part of this dep.
  }, [scrapeDate, lastUpdatedAt]);

  const { agents, hour } = useMemo(() => {
    // Build per-agent latest cumulative (max scrape_hour wins per agent).
    const latestByAgent = new Map<string, IntradayRow>();
    let maxHour = 0;
    for (const row of intradayRows) {
      const existing = latestByAgent.get(row.agent_name);
      if (!existing || row.scrape_hour > existing.scrape_hour) {
        latestByAgent.set(row.agent_name, row);
      }
      if (row.scrape_hour > maxHour) maxHour = row.scrape_hour;
    }

    // If no rows yet, fall back to the wall-clock Central hour so the
    // headline at least reflects "9 AM, no data" instead of "midnight".
    const effectiveHour = maxHour > 0 ? maxHour : getCentralHour();

    const profileByName = new Map(profiles.map((p) => [p.name, p]));
    const summaries: AgentLiveSummary[] = [];

    for (const [name, row] of Array.from(latestByAgent.entries())) {
      const profile = profileByName.get(name);
      if (!profile) continue; // agent not in cohort baselines (no 30-day signal)
      const baseline = baselines.get(profile.cohort);
      const cum: AgentIntradayCumulative = {
        agentName: name,
        hour: effectiveHour,
        totalDials: (row.total_dials ?? 0) + (row.pool_dials ?? 0),
        talkMin: (row.talk_time_minutes ?? 0) + (row.pool_talk_minutes ?? 0),
        poolDials: row.pool_dials ?? 0,
        poolLongCalls: row.pool_long_calls ?? 0,
        poolSelfAssigned: row.pool_self_assigned ?? 0,
      };
      const summary = buildAgentLiveSummary(cum, profile.cohort, baseline);
      if (summary) summaries.push(summary);
    }

    return { agents: summaries, hour: effectiveHour };
  }, [intradayRows, profiles, baselines]);

  const pulse = useMemo(() => summarizeOrgPulse(agents, hour), [agents, hour]);

  return {
    loading: loading || baselinesLoading,
    error,
    hour,
    paceFraction: paceFraction(hour),
    agents,
    pulse,
    scrapeDate,
  };
}
