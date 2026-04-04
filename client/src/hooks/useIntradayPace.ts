import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { T3_PACE_CURVE, T3_INTRADAY_TARGETS, BUSINESS_HOURS } from "@/lib/t3Targets";

interface IntradayRow {
  agent_name: string;
  scrape_hour: number;
  total_dials: number;
  talk_time_minutes: number;
  pool_dials: number;
  pool_talk_minutes: number;
  pool_long_calls: number;
  pool_self_assigned: number;
}

export interface PaceMetric {
  actual: number;
  expected: number;
  pct: number;
  behind: boolean;
}

export interface AgentPaceStatus {
  name: string;
  site: string;
  hour: number;
  metrics: {
    combinedDials: PaceMetric;
    talkTime: PaceMetric;
    longCalls: PaceMetric;
    poolDials: PaceMetric;
  };
  behindMetrics: string[];
  status: "on_pace" | "behind" | "critical";
}

export interface PaceSummary {
  totalAgents: number;
  onPace: number;
  behind: number;
  critical: number;
  currentHour: number;
  isBusinessHours: boolean;
  scrapeDate: string;
}

function getCentralHour(): number {
  const now = new Date();
  const central = new Date(now.toLocaleString("en-US", { timeZone: "America/Chicago" }));
  return central.getHours();
}

function getCentralDate(): string {
  const now = new Date();
  const central = new Date(now.toLocaleString("en-US", { timeZone: "America/Chicago" }));
  return central.toISOString().slice(0, 10);
}

function isWeekday(): boolean {
  const now = new Date();
  const central = new Date(now.toLocaleString("en-US", { timeZone: "America/Chicago" }));
  const day = central.getDay();
  return day >= 1 && day <= 5;
}

function buildPaceMetric(actual: number, dailyTarget: number, curveValue: number): PaceMetric {
  const expected = Math.round(dailyTarget * curveValue);
  const pct = expected > 0 ? (actual / expected) * 100 : (actual > 0 ? 100 : 0);
  const behind = actual < expected * T3_INTRADAY_TARGETS.BEHIND_THRESHOLD;
  return { actual, expected, pct, behind };
}

export function useIntradayPace(overrideDate?: string) {
  const [agents, setAgents] = useState<AgentPaceStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const isLive = !overrideDate || overrideDate === getCentralDate();
  const currentHour = getCentralHour();
  const isBusinessHrs = isLive && currentHour >= BUSINESS_HOURS.START && currentHour <= BUSINESS_HOURS.END && isWeekday();

  const fetchPace = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    setLoading(true);

    try {
      const todayStr = overrideDate ?? getCentralDate();
      const hour = isLive ? getCentralHour() : BUSINESS_HOURS.END;

      const [{ data: snapRows }, { data: agentRows }] = await Promise.all([
        supabase.from("intraday_snapshots")
          .select("agent_name, scrape_hour, total_dials, talk_time_minutes, pool_dials, pool_talk_minutes, pool_long_calls, pool_self_assigned")
          .eq("scrape_date", todayStr)
          .eq("tier", "T3")
          .order("scrape_hour", { ascending: false }),
        supabase.from("agents")
          .select("name, site")
          .eq("tier", "T3")
          .eq("is_active", true),
      ]);

      if (!snapRows || !agentRows) { setAgents([]); return; }

      const siteMap = new Map<string, string>();
      for (const a of agentRows as Array<{ name: string; site: string }>) {
        siteMap.set(a.name, a.site);
      }

      // Get the latest snapshot per agent
      const latestByAgent = new Map<string, IntradayRow>();
      for (const r of snapRows as IntradayRow[]) {
        if (!latestByAgent.has(r.agent_name)) {
          latestByAgent.set(r.agent_name, r);
        }
      }

      // Find the closest pace curve value for the current hour
      const curveHour = Math.min(Math.max(hour, BUSINESS_HOURS.START), BUSINESS_HOURS.END);
      const curveValue = T3_PACE_CURVE[curveHour] ?? 1.0;

      const results: AgentPaceStatus[] = [];
      for (const [name, row] of latestByAgent) {
        if (!siteMap.has(name)) continue;

        // Use the agent's latest snapshot hour for the curve, not wall clock,
        // so we compare what they've done vs what they should have by that hour
        const agentCurveHour = Math.min(Math.max(row.scrape_hour, BUSINESS_HOURS.START), BUSINESS_HOURS.END);
        const agentCurve = T3_PACE_CURVE[agentCurveHour] ?? curveValue;

        const combinedDials = buildPaceMetric(
          (row.total_dials ?? 0) + (row.pool_dials ?? 0),
          T3_INTRADAY_TARGETS.COMBINED_DIALS, agentCurve);
        const talkTime = buildPaceMetric(
          (row.talk_time_minutes ?? 0) + (row.pool_talk_minutes ?? 0),
          T3_INTRADAY_TARGETS.TALK_TIME, agentCurve);
        const longCalls = buildPaceMetric(
          row.pool_long_calls ?? 0,
          T3_INTRADAY_TARGETS.LONG_CALLS, agentCurve);
        const poolDials = buildPaceMetric(
          row.pool_dials ?? 0,
          T3_INTRADAY_TARGETS.POOL_DIALS, agentCurve);

        const behindMetrics: string[] = [];
        if (combinedDials.behind) behindMetrics.push("Dials");
        if (talkTime.behind) behindMetrics.push("Talk Time");
        if (longCalls.behind) behindMetrics.push("Long Calls");
        if (poolDials.behind) behindMetrics.push("Pool Dials");

        const status: AgentPaceStatus["status"] =
          behindMetrics.length >= 3 ? "critical"
          : behindMetrics.length > 0 ? "behind"
          : "on_pace";

        results.push({
          name,
          site: siteMap.get(name) ?? "—",
          hour: row.scrape_hour,
          metrics: { combinedDials, talkTime, longCalls, poolDials },
          behindMetrics,
          status,
        });
      }

      // Sort: critical first, then behind, then on_pace; within each group, most behind first
      results.sort((a, b) => {
        const rank = { critical: 0, behind: 1, on_pace: 2 };
        if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
        return a.behindMetrics.length === b.behindMetrics.length
          ? a.metrics.combinedDials.pct - b.metrics.combinedDials.pct
          : b.behindMetrics.length - a.behindMetrics.length;
      });

      setAgents(results);
      setLastRefresh(new Date());
    } catch {
      // keep existing
    } finally {
      setLoading(false);
    }
  }, [overrideDate, isLive]);

  useEffect(() => { fetchPace(); }, [fetchPace]);

  // Auto-refresh at the top of each hour (aligned to scrape schedule)
  useEffect(() => {
    if (!isLive) return;
    const now = new Date();
    const msUntilNextHour = (60 - now.getMinutes()) * 60 * 1000 - now.getSeconds() * 1000;
    const delay = msUntilNextHour + 5 * 60_000; // 5 min after the hour to let the scrape finish
    const timeout = setTimeout(() => {
      fetchPace();
      const interval = setInterval(fetchPace, 60 * 60 * 1000);
      return () => clearInterval(interval);
    }, delay);
    return () => clearTimeout(timeout);
  }, [fetchPace, isLive]);

  const summary = useMemo<PaceSummary>(() => ({
    totalAgents: agents.length,
    onPace: agents.filter(a => a.status === "on_pace").length,
    behind: agents.filter(a => a.status === "behind").length,
    critical: agents.filter(a => a.status === "critical").length,
    currentHour: getCentralHour(),
    isBusinessHours: isBusinessHrs,
    scrapeDate: getCentralDate(),
  }), [agents, isBusinessHrs]);

  const behindAgents = useMemo(() => agents.filter(a => a.status !== "on_pace"), [agents]);

  return { agents, behindAgents, summary, loading, lastRefresh, refresh: fetchPace };
}
