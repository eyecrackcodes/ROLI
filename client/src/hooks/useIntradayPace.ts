import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { T3_PACE_CURVE, T3_INTRADAY_TARGETS, BUSINESS_HOURS } from "@/lib/t3Targets";
import { UNIFIED_PACE_CURVE, UNIFIED_INTRADAY_TARGETS } from "@/lib/unifiedTargets";

interface IntradayRow {
  agent_name: string;
  scrape_hour: number;
  total_dials: number;
  talk_time_minutes: number;
  ib_leads_delivered: number;
  ib_sales: number;
  pool_dials: number;
  pool_talk_minutes: number;
  pool_long_calls: number;
  pool_self_assigned: number;
}

export interface PaceMetric {
  actual: number;
  expected: number;
  pct: number;
  /** Naive end-of-day projection at current rate (actual / curveValue). 0 before 9 AM. */
  projected: number;
  behind: boolean;
}

/**
 * Agent presence inferred from cumulative intraday activity.
 * - active:      has non-zero dials/talk/leads at the latest snapshot
 * - idle:        appeared in snapshot but cumulative activity = 0 past 10 AM CST
 * - not_started: no snapshot row yet today (likely not logged in / called out)
 */
export type AgentPresence = "active" | "idle" | "not_started";

export interface AgentPaceStatus {
  name: string;
  site: string;
  hour: number;
  metrics: {
    combinedDials: PaceMetric;
    talkTime: PaceMetric;
    longCalls: PaceMetric;
    poolDials: PaceMetric;
    /** Inbound leads taken so far today, paced against the 7/day unified target. */
    ibLeads: PaceMetric;
  };
  behindMetrics: string[];
  status: "on_pace" | "behind" | "critical";
  presence: AgentPresence;
}

export interface PaceSummary {
  totalAgents: number;
  onPace: number;
  behind: number;
  critical: number;
  /** Active agents with cumulative activity = 0 past 10 AM. */
  idle: number;
  /** Active agents with no snapshot row at all today (likely absent). */
  notStarted: number;
  currentHour: number;
  isBusinessHours: boolean;
  scrapeDate: string;
  /** Org-wide IB leads taken so far today (active agents only). */
  ibLeadsActual: number;
  /** Org-wide expected IB leads by current hour (active agents × 7 × paceCurve). */
  ibLeadsExpected: number;
  /** Org-wide naive EOD projection at current rate (active agents only). */
  ibLeadsProjected: number;
  /** Number of agents counted in the org IB pace math (excludes idle/not_started). */
  ibLeadsActiveAgents: number;
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
  // Naive linear projection: if you're at X% of day done, your EOD projection is actual / curveValue.
  // Returns 0 when the day hasn't started (curveValue = 0) so we don't divide by zero.
  const projected = curveValue > 0 ? Math.round(actual / curveValue) : actual;
  return { actual, expected, pct, projected, behind };
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
          .select("agent_name, scrape_hour, total_dials, talk_time_minutes, ib_leads_delivered, ib_sales, pool_dials, pool_talk_minutes, pool_long_calls, pool_self_assigned")
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

      // Roll up each agent's day with MAX across all snapshot rows.
      // Every column we read is cumulative (monotonically non-decreasing), so
      // MAX is the correct aggregation. This also makes us robust to "stub"
      // rows written by cross-source ingest paths — e.g. the hourly ICD
      // scraper inserts a row at hour H+1 with the CRM-side columns defaulted
      // to 0 before the CRM scraper has reached hour H+1. A naive "latest
      // row wins" picks that stub and momentarily shows every agent as having
      // zero dials / zero talk / zero leads. MAX-rollup ignores those stubs
      // because cumulative numbers can never legitimately decrease.
      const aggregateByAgent = new Map<string, IntradayRow>();
      for (const r of snapRows as IntradayRow[]) {
        const prev = aggregateByAgent.get(r.agent_name);
        if (!prev) {
          aggregateByAgent.set(r.agent_name, { ...r });
          continue;
        }
        aggregateByAgent.set(r.agent_name, {
          agent_name: r.agent_name,
          scrape_hour: Math.max(prev.scrape_hour, r.scrape_hour),
          total_dials: Math.max(prev.total_dials ?? 0, r.total_dials ?? 0),
          talk_time_minutes: Math.max(Number(prev.talk_time_minutes ?? 0), Number(r.talk_time_minutes ?? 0)),
          ib_leads_delivered: Math.max(prev.ib_leads_delivered ?? 0, r.ib_leads_delivered ?? 0),
          ib_sales: Math.max(prev.ib_sales ?? 0, r.ib_sales ?? 0),
          pool_dials: Math.max(prev.pool_dials ?? 0, r.pool_dials ?? 0),
          pool_talk_minutes: Math.max(Number(prev.pool_talk_minutes ?? 0), Number(r.pool_talk_minutes ?? 0)),
          pool_long_calls: Math.max(prev.pool_long_calls ?? 0, r.pool_long_calls ?? 0),
          pool_self_assigned: Math.max(prev.pool_self_assigned ?? 0, r.pool_self_assigned ?? 0),
        });
      }

      const curveHour = Math.min(Math.max(hour, BUSINESS_HOURS.START), BUSINESS_HOURS.END);
      // Org-level absence cutoff: agents with no row at all and we're past 10 AM
      // are flagged "Not Started" (giving them ≥1 hour after the 9 AM start to log in).
      const ABSENCE_HOUR_FLOOR = 10;

      const results: AgentPaceStatus[] = [];
      // Iterate over the active roster (not the snapshot rows) so absent agents
      // remain visible in the pacer instead of silently disappearing.
      for (const [name, info] of agentInfo) {
        const row = aggregateByAgent.get(name);

        // Determine presence first — short-circuits behind-flag noise for
        // agents who weren't here to perform.
        let presence: AgentPresence;
        if (!row) {
          presence = curveHour >= ABSENCE_HOUR_FLOOR ? "not_started" : "active";
        } else {
          const cumulativeActivity = (row.total_dials ?? 0) + Number(row.talk_time_minutes ?? 0) + (row.ib_leads_delivered ?? 0);
          presence = cumulativeActivity === 0 && row.scrape_hour >= ABSENCE_HOUR_FLOOR ? "idle" : "active";
        }

        const agentCurveHour = row
          ? Math.min(Math.max(row.scrape_hour, BUSINESS_HOURS.START), BUSINESS_HOURS.END)
          : curveHour;

        // Use T3-specific targets for legacy T3 agents, unified for everyone else
        const isT3 = info.tier === "T3";
        const paceCurve = isT3 ? T3_PACE_CURVE : UNIFIED_PACE_CURVE;
        const agentCurve = paceCurve[agentCurveHour] ?? (paceCurve[curveHour] ?? 1.0);
        const threshold = isT3 ? T3_INTRADAY_TARGETS.BEHIND_THRESHOLD : UNIFIED_INTRADAY_TARGETS.BEHIND_THRESHOLD;

        const buildMetric = (actual: number, target: number): PaceMetric => {
          const expected = Math.round(target * agentCurve);
          const pct = expected > 0 ? (actual / expected) * 100 : (actual > 0 ? 100 : 0);
          const projected = agentCurve > 0 ? Math.round(actual / agentCurve) : actual;
          return { actual, expected, pct, projected, behind: actual < expected * threshold };
        };

        const combinedDials = isT3
          ? buildMetric(row?.total_dials ?? 0, T3_INTRADAY_TARGETS.COMBINED_DIALS)
          : buildMetric(row?.total_dials ?? 0, UNIFIED_INTRADAY_TARGETS.IB_LEADS * 30);
        const talkTime = isT3
          ? buildMetric(Number(row?.talk_time_minutes ?? 0), T3_INTRADAY_TARGETS.TALK_TIME)
          : buildMetric(Number(row?.talk_time_minutes ?? 0), UNIFIED_INTRADAY_TARGETS.TALK_TIME);
        const longCalls = buildMetric(
          row?.pool_long_calls ?? 0,
          isT3 ? T3_INTRADAY_TARGETS.LONG_CALLS : 2);
        const poolDials = buildMetric(
          row?.pool_dials ?? 0,
          isT3 ? T3_INTRADAY_TARGETS.POOL_DIALS : UNIFIED_INTRADAY_TARGETS.POOL_FOLLOWUPS * 10);
        // IB leads pace toward the 7-leads-per-day unified target. Legacy T3
        // agents pace against the same 7 since the IB delivery cap is org-wide.
        const ibLeads = buildMetric(
          row?.ib_leads_delivered ?? 0,
          UNIFIED_INTRADAY_TARGETS.IB_LEADS,
        );

        const behindMetrics: string[] = [];
        // Skip behind-metric flagging for idle/absent — there's nothing
        // actionable about saying "their pace is bad" when they're not here.
        if (presence === "active") {
          if (combinedDials.behind) behindMetrics.push("Dials");
          if (talkTime.behind) behindMetrics.push("Talk Time");
          if (longCalls.behind) behindMetrics.push("Long Calls");
          if (poolDials.behind) behindMetrics.push("Pool Dials");
        }

        const status: AgentPaceStatus["status"] =
          behindMetrics.length >= 3 ? "critical"
          : behindMetrics.length > 0 ? "behind"
          : "on_pace";

        results.push({
          name,
          site: info.site,
          hour: row?.scrape_hour ?? 0,
          metrics: { combinedDials, talkTime, longCalls, poolDials, ibLeads },
          behindMetrics,
          status,
          presence,
        });
      }

      // Sort: active agents first (critical → behind → on_pace by deficit),
      // then idle, then not_started. Keeps the LeadsPool PaceTracker visually
      // unchanged for working agents while keeping absent ones visible at the bottom.
      results.sort((a, b) => {
        const presenceRank = { active: 0, idle: 1, not_started: 2 };
        if (presenceRank[a.presence] !== presenceRank[b.presence]) {
          return presenceRank[a.presence] - presenceRank[b.presence];
        }
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

  const summary = useMemo<PaceSummary>(() => {
    // Org-level IB pace math only counts agents who actually showed up.
    // Including idle/not_started would understate everyone else's effort.
    const activeAgents = agents.filter(a => a.presence === "active");
    const ibLeadsActual = activeAgents.reduce((s, a) => s + a.metrics.ibLeads.actual, 0);
    const ibLeadsExpected = activeAgents.reduce((s, a) => s + a.metrics.ibLeads.expected, 0);
    const ibLeadsProjected = activeAgents.reduce((s, a) => s + a.metrics.ibLeads.projected, 0);

    return {
      totalAgents: agents.length,
      onPace: activeAgents.filter(a => a.status === "on_pace").length,
      behind: activeAgents.filter(a => a.status === "behind").length,
      critical: activeAgents.filter(a => a.status === "critical").length,
      idle: agents.filter(a => a.presence === "idle").length,
      notStarted: agents.filter(a => a.presence === "not_started").length,
      currentHour: getCentralHour(),
      isBusinessHours: isBusinessHrs,
      scrapeDate: getCentralDate(),
      ibLeadsActual,
      ibLeadsExpected,
      ibLeadsProjected,
      ibLeadsActiveAgents: activeAgents.length,
    };
  }, [agents, isBusinessHrs]);

  const behindAgents = useMemo(() => agents.filter(a => a.status !== "on_pace" && a.presence === "active"), [agents]);

  return { agents, behindAgents, summary, loading, lastRefresh, refresh: fetchPace };
}
