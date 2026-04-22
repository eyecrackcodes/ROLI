// ============================================================
// useIntradayRpaPace
//
// Mirror of useIntradayPace, but for the unified Revenue Producing
// Activity (RPA) target — 300 min/day per agent.
//
// Data shape:
//   intraday_snapshots holds one cumulative row per (agent, hour).
//     CRM scraper writes:  total_dials, talk_time_minutes (= outbound talk)
//     ICD intraday writes: queue_minutes, inbound_talk_minutes, avg_wait_minutes
//
// RPA per agent (intraday) =
//     queue_minutes
//   + inbound_talk_minutes
//   + talk_time_minutes              (CRM = outbound talk)
//   + total_dials × DIAL_OVERHEAD    (inferred connect/wrap overhead)
//
// Pace math is identical to LeadPacer:
//   expected = RPA_MINUTES × paceCurve[hour]
//   pct      = actual / expected × 100
//   behind   = actual < expected × BEHIND_THRESHOLD
//   projected = actual / paceCurve[hour]    (naive linear EOD projection)
// ============================================================

import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { UNIFIED_PACE_CURVE, UNIFIED_INTRADAY_TARGETS } from "@/lib/unifiedTargets";
import { BUSINESS_HOURS } from "@/lib/t3Targets";

interface RpaRow {
  agent_name: string;
  scrape_hour: number;
  total_dials: number | null;
  talk_time_minutes: number | string | null;
  queue_minutes: number | string | null;
  inbound_talk_minutes: number | string | null;
  ib_leads_delivered: number | null;
}

export type RpaPresence = "active" | "idle" | "not_started";

export interface RpaComponents {
  queue: number;
  inboundTalk: number;
  outboundTalk: number;
  dialOverhead: number;
}

export interface RpaPaceMetric {
  /** Total RPA minutes accumulated so far. */
  actual: number;
  /** Pace-curve expected RPA minutes by this hour. */
  expected: number;
  /** actual / expected × 100. 100 = on pace. */
  pct: number;
  /** Naive EOD projection: actual / curveValue. */
  projected: number;
  /** True when actual < expected × BEHIND_THRESHOLD. */
  behind: boolean;
  /** Per-component breakdown for tooltips/drilldown. */
  components: RpaComponents;
}

export interface AgentRpaStatus {
  name: string;
  site: string;
  hour: number;
  presence: RpaPresence;
  metrics: { rpa: RpaPaceMetric };
  status: "on_pace" | "behind" | "critical";
  /**
   * Whether the ICD scrape has landed for this agent yet today.
   * False means queue/inbound_talk are still 0 — the row exists but only
   * the CRM scraper has written. Used to render an "IB pending" hint.
   */
  hasIcdData: boolean;
}

export interface RpaSummary {
  totalAgents: number;
  activeAgents: number;
  onPace: number;
  behind: number;
  critical: number;
  idle: number;
  notStarted: number;
  /** Sum of all active agents' RPA actuals. */
  totalActual: number;
  /** Sum of all active agents' RPA expected (active count × target × curve). */
  totalExpected: number;
  /** Sum of all active agents' projected EOD RPA. */
  totalProjected: number;
  /** Active count × RPA_MINUTES. */
  totalTarget: number;
  /** Number of active agents whose ICD data has not landed yet today. */
  awaitingIcd: number;
  currentHour: number;
  scrapeDate: string;
}

const ABSENCE_HOUR_FLOOR = 10;

function getCentralHour(): number {
  const central = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Chicago" }));
  return central.getHours();
}

function getCentralDate(): string {
  const central = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Chicago" }));
  return central.toISOString().slice(0, 10);
}

function n(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const x = typeof v === "string" ? parseFloat(v) : v;
  return Number.isFinite(x) ? x : 0;
}

export function useIntradayRpaPace(overrideDate?: string) {
  const [agents, setAgents] = useState<AgentRpaStatus[]>([]);
  const [loading, setLoading] = useState(true);

  const isLive = !overrideDate || overrideDate === getCentralDate();

  const fetchPace = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setAgents([]);
      setLoading(false);
      return;
    }
    setLoading(true);

    try {
      const todayStr = overrideDate ?? getCentralDate();
      const hour = isLive ? getCentralHour() : BUSINESS_HOURS.END;

      const [{ data: snapRows }, { data: agentRows }] = await Promise.all([
        supabase.from("intraday_snapshots")
          .select("agent_name, scrape_hour, total_dials, talk_time_minutes, queue_minutes, inbound_talk_minutes, ib_leads_delivered")
          .eq("scrape_date", todayStr)
          .order("scrape_hour", { ascending: false }),
        supabase.from("agents")
          .select("name, site")
          .eq("is_active", true),
      ]);

      if (!snapRows || !agentRows) {
        setAgents([]);
        return;
      }

      const agentInfo = new Map<string, { site: string }>();
      for (const a of agentRows as Array<{ name: string; site: string }>) {
        agentInfo.set(a.name, { site: a.site });
      }

      // Latest snapshot per agent. Cumulative numbers — last row of the day
      // is end-of-day total; current hour's row is "now".
      const latestByAgent = new Map<string, RpaRow>();
      for (const r of snapRows as RpaRow[]) {
        if (!latestByAgent.has(r.agent_name)) latestByAgent.set(r.agent_name, r);
      }

      const curveHour = Math.min(Math.max(hour, BUSINESS_HOURS.START), BUSINESS_HOURS.END);
      const target = UNIFIED_INTRADAY_TARGETS.RPA_MINUTES;
      const overhead = UNIFIED_INTRADAY_TARGETS.DIAL_OVERHEAD_MIN;
      const threshold = UNIFIED_INTRADAY_TARGETS.BEHIND_THRESHOLD;

      const out: AgentRpaStatus[] = [];

      for (const [name, info] of agentInfo) {
        const row = latestByAgent.get(name);

        let presence: RpaPresence;
        if (!row) {
          presence = curveHour >= ABSENCE_HOUR_FLOOR ? "not_started" : "active";
        } else {
          // "Active" if ANY activity is on the row — dials, talk, queue, or leads.
          // We can't require ICD data, since the CRM scrape may have landed first.
          const totalActivity =
            (row.total_dials ?? 0) + n(row.talk_time_minutes) +
            n(row.queue_minutes) + n(row.inbound_talk_minutes) +
            (row.ib_leads_delivered ?? 0);
          presence = totalActivity === 0 && row.scrape_hour >= ABSENCE_HOUR_FLOOR
            ? "idle"
            : "active";
        }

        const agentCurveHour = row
          ? Math.min(Math.max(row.scrape_hour, BUSINESS_HOURS.START), BUSINESS_HOURS.END)
          : curveHour;
        const agentCurve = UNIFIED_PACE_CURVE[agentCurveHour] ?? UNIFIED_PACE_CURVE[curveHour] ?? 1.0;

        const components: RpaComponents = {
          queue:        Math.round(n(row?.queue_minutes)        * 10) / 10,
          inboundTalk:  Math.round(n(row?.inbound_talk_minutes) * 10) / 10,
          outboundTalk: Math.round(n(row?.talk_time_minutes)    * 10) / 10,
          dialOverhead: Math.round((row?.total_dials ?? 0) * overhead * 10) / 10,
        };

        const actual = Math.round(
          (components.queue + components.inboundTalk + components.outboundTalk + components.dialOverhead) * 10,
        ) / 10;

        const expected = Math.round(target * agentCurve);
        const pct = expected > 0 ? (actual / expected) * 100 : (actual > 0 ? 100 : 0);
        const projected = agentCurve > 0 ? Math.round(actual / agentCurve) : Math.round(actual);
        const behind = actual < expected * threshold;
        const status: AgentRpaStatus["status"] =
          actual < expected * 0.5 ? "critical"
          : behind ? "behind"
          : "on_pace";

        // ICD scrape landed if EITHER queue or inbound talk has any value.
        // A truly silent inbound day still flips this true once queue logs in.
        const hasIcdData = components.queue > 0 || components.inboundTalk > 0;

        out.push({
          name,
          site: info.site,
          hour: row?.scrape_hour ?? 0,
          presence,
          metrics: {
            rpa: { actual, expected, pct, projected, behind, components },
          },
          status,
          hasIcdData,
        });
      }

      // Sort: behind first (worst pct), then on-pace, then idle, then absent.
      const presenceRank: Record<RpaPresence, number> = { active: 0, idle: 1, not_started: 2 };
      const statusRank: Record<AgentRpaStatus["status"], number> = { critical: 0, behind: 1, on_pace: 2 };
      out.sort((a, b) => {
        if (presenceRank[a.presence] !== presenceRank[b.presence]) {
          return presenceRank[a.presence] - presenceRank[b.presence];
        }
        if (statusRank[a.status] !== statusRank[b.status]) {
          return statusRank[a.status] - statusRank[b.status];
        }
        return a.metrics.rpa.pct - b.metrics.rpa.pct;
      });

      setAgents(out);
    } catch {
      // keep prior state
    } finally {
      setLoading(false);
    }
  }, [overrideDate, isLive]);

  useEffect(() => { fetchPace(); }, [fetchPace]);

  // Auto-refresh ~5 minutes after the top of each hour (after scrapes land).
  useEffect(() => {
    if (!isLive) return;
    const now = new Date();
    const msUntilNextHour = (60 - now.getMinutes()) * 60 * 1000 - now.getSeconds() * 1000;
    const delay = msUntilNextHour + 5 * 60_000;
    const timeout = setTimeout(() => {
      fetchPace();
      const interval = setInterval(fetchPace, 60 * 60 * 1000);
      return () => clearInterval(interval);
    }, delay);
    return () => clearTimeout(timeout);
  }, [fetchPace, isLive]);

  const summary = useMemo<RpaSummary>(() => {
    const active = agents.filter((a) => a.presence === "active");
    const totalActual = active.reduce((s, a) => s + a.metrics.rpa.actual, 0);
    const totalExpected = active.reduce((s, a) => s + a.metrics.rpa.expected, 0);
    const totalProjected = active.reduce((s, a) => s + a.metrics.rpa.projected, 0);
    const totalTarget = active.length * UNIFIED_INTRADAY_TARGETS.RPA_MINUTES;
    return {
      totalAgents: agents.length,
      activeAgents: active.length,
      onPace: active.filter((a) => a.status === "on_pace").length,
      behind: active.filter((a) => a.status === "behind").length,
      critical: active.filter((a) => a.status === "critical").length,
      idle: agents.filter((a) => a.presence === "idle").length,
      notStarted: agents.filter((a) => a.presence === "not_started").length,
      totalActual: Math.round(totalActual),
      totalExpected: Math.round(totalExpected),
      totalProjected: Math.round(totalProjected),
      totalTarget,
      awaitingIcd: active.filter((a) => !a.hasIcdData).length,
      currentHour: getCentralHour(),
      scrapeDate: overrideDate ?? getCentralDate(),
    };
  }, [agents, overrideDate]);

  return { agents, summary, loading, refresh: fetchPace };
}
