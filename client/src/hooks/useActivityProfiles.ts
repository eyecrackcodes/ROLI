import { useState, useEffect, useCallback } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import {
  buildOrgActivityAnalysis,
  type AgentActivityProfile,
  type CohortBaseline,
  type ActivityAnomaly,
  type DailyScrapeRow,
  type PoolRow,
  type FunnelRow,
  type AgentRosterEntry,
} from "@/lib/activityProfile";
import { computeTenure, type TenureCohort } from "@/lib/tenure";

interface AgentRow {
  name: string;
  hired_date: string | null;
  is_active: boolean;
  terminated_date: string | null;
}

export interface ActivityProfilesResult {
  profiles: AgentActivityProfile[];
  baselines: Map<TenureCohort, CohortBaseline>;
  anomaliesByAgent: Map<string, ActivityAnomaly[]>;
  windowStart: string;
  windowEnd: string;
  loading: boolean;
  error: string | null;
}

function isoDaysAgo(days: number, ref: Date = new Date()): string {
  const d = new Date(ref);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * Fetches the last `windowDays` of activity for every active agent (or any
 * agent whose terminated_date is after the window start) and produces:
 *   - per-agent activity profiles (rolled up over the window)
 *   - cohort baselines (median + IQR per tenure cohort)
 *   - per-agent anomaly flags
 *
 * Defaults to a 30-day rolling window — short enough to react to recent
 * behavioral shifts, long enough to smooth out single-day noise.
 */
export function useActivityProfiles(windowDays = 30, refreshKey = 0): ActivityProfilesResult {
  const [profiles, setProfiles] = useState<AgentActivityProfile[]>([]);
  const [baselines, setBaselines] = useState<Map<TenureCohort, CohortBaseline>>(new Map());
  const [anomaliesByAgent, setAnomaliesByAgent] = useState<Map<string, ActivityAnomaly[]>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const windowEnd = new Date().toISOString().slice(0, 10);
  const windowStart = isoDaysAgo(windowDays);

  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setError("Supabase not configured");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [
        { data: agentRows, error: aerr },
        { data: prodRows, error: perr },
        { data: poolRows, error: lerr },
        { data: funnelRows, error: ferr },
      ] = await Promise.all([
        supabase
          .from("agents")
          .select("name, hired_date, is_active, terminated_date"),
        supabase
          .from("daily_scrape_data")
          .select("agent_name, scrape_date, total_dials, talk_time_minutes, ib_leads_delivered, ob_leads_delivered, ib_sales, ob_sales, custom_sales, ib_premium, ob_premium, custom_premium")
          .gte("scrape_date", windowStart)
          .lte("scrape_date", windowEnd),
        supabase
          .from("leads_pool_daily_data")
          .select("agent_name, scrape_date, calls_made, talk_time_minutes, answered_calls, self_assigned_leads, long_calls, sales_made")
          .gte("scrape_date", windowStart)
          .lte("scrape_date", windowEnd),
        supabase
          .from("agent_performance_daily")
          .select("agent_name, scrape_date, scrape_hour, conversations, presentations, contacts_made")
          .gte("scrape_date", windowStart)
          .lte("scrape_date", windowEnd),
      ]);

      const firstErr = aerr ?? perr ?? lerr ?? ferr;
      if (firstErr) {
        throw new Error(firstErr.message);
      }

      const today = windowEnd;
      const roster: AgentRosterEntry[] = ((agentRows ?? []) as AgentRow[])
        .filter((a) => a.is_active || (a.terminated_date && today <= a.terminated_date))
        .map((a) => ({
          name: a.name,
          hired_date: a.hired_date,
          cohort: computeTenure(a.hired_date).cohort,
        }));

      const analysis = buildOrgActivityAnalysis(
        roster,
        (prodRows ?? []) as DailyScrapeRow[],
        (poolRows ?? []) as PoolRow[],
        (funnelRows ?? []) as FunnelRow[],
      );

      setProfiles(analysis.profiles);
      setBaselines(analysis.baselines);
      setAnomaliesByAgent(analysis.anomaliesByAgent);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setProfiles([]);
      setBaselines(new Map());
      setAnomaliesByAgent(new Map());
    } finally {
      setLoading(false);
    }
  }, [windowEnd, windowStart]);

  useEffect(() => {
    refresh();
  }, [refresh, refreshKey]);

  return {
    profiles,
    baselines,
    anomaliesByAgent,
    windowStart,
    windowEnd,
    loading,
    error,
  };
}
