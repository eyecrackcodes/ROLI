import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { T3_PACE_CURVE, T3_INTRADAY_TARGETS, BUSINESS_HOURS } from "@/lib/t3Targets";
import { UNIFIED_PACE_CURVE, UNIFIED_INTRADAY_TARGETS } from "@/lib/unifiedTargets";

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
          .order("scrape_hour", { ascending: false }),
        supabase.from("agents")
          .select("name, site, tier")
          .eq("is_active", true),
      ]);

      if (!snapRows || !agentRows) { setAgents([]); return; }

      const agentInfo = new Map<string, { site: string; tier: string }>();
      for (const a of agentRows as Array<{ name: string; site: string; tier: string }>) {
        agentInfo.set(a.name, { site: a.site, tier: a.tier });
      }

      const latestByAgent = new Map<string, IntradayRow>();
      for (const r of snapRows as IntradayRow[]) {
        if (!latestByAgent.has(r.agent_name)) {
          latestByAgent.set(r.agent_name, r);
        }
      }

      const curveHour = Math.min(Math.max(hour, BUSINESS_HOURS.START), BUSINESS_HOURS.END);

      const results: AgentPaceStatus[] = [];
      for (const [name, row] of latestByAgent) {
        const info = agentInfo.get(name);
        if (!info) continue;

        const agentCurveHour = Math.min(Math.max(row.scrape_hour, BUSINESS_HOURS.START), BUSINESS_HOURS.END);

        // Use T3-specific targets for legacy T3 agents, unified for everyone else
        const isT3 = info.tier === "T3";
        const paceCurve = isT3 ? T3_PACE_CURVE : UNIFIED_PACE_CURVE;
        const agentCurve = paceCurve[agentCurveHour] ?? (paceCurve[curveHour] ?? 1.0);
        const threshold = isT3 ? T3_INTRADAY_TARGETS.BEHIND_THRESHOLD : UNIFIED_INTRADAY_TARGETS.BEHIND_THRESHOLD;

        const buildMetric = (actual: number, target: number): PaceMetric => {
          const expected = Math.round(target * agentCurve);
          const pct = expected > 0 ? (actual / expected) * 100 : (actual > 0 ? 100 : 0);
          return { actual, expected, pct, behind: actual < expected * threshold };
        };

        const combinedDials = isT3
          ? buildMetric(row.total_dials ?? 0, T3_INTRADAY_TARGETS.COMBINED_DIALS)
          : buildMetric(row.total_dials ?? 0, UNIFIED_INTRADAY_TARGETS.IB_LEADS * 30);
        const talkTime = isT3
          ? buildMetric(row.talk_time_minutes ?? 0, T3_INTRADAY_TARGETS.TALK_TIME)
          : buildMetric(row.talk_time_minutes ?? 0, UNIFIED_INTRADAY_TARGETS.TALK_TIME);
        const longCalls = buildMetric(
          row.pool_long_calls ?? 0,
          isT3 ? T3_INTRADAY_TARGETS.LONG_CALLS : 2);
        const poolDials = buildMetric(
          row.pool_dials ?? 0,
          isT3 ? T3_INTRADAY_TARGETS.POOL_DIALS : UNIFIED_INTRADAY_TARGETS.POOL_FOLLOWUPS * 10);

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
          site: info.site,
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
