import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { BUSINESS_HOURS } from "@/lib/tierTargets";
import type { Tier } from "@/lib/types";
import {
  computeRecommendations,
  type AgentRecommendation,
  type WeeklyAgentStats,
  type PipelineSnapshot,
  type IntradaySnapshot,
  type PoolSnapshot,
} from "@/lib/actionRecommender";
import { fetchMarketingSummary } from "@/lib/marketingSummary";

export interface ActionCenterSummary {
  totalAgents: number;
  critical: number;
  warning: number;
  onTrack: number;
  currentHour: number;
  isBusinessHours: boolean;
  scrapeDate: string;
}

function getCentralHour(): number {
  return Number(
    new Date().toLocaleString("en-US", {
      timeZone: "America/Chicago",
      hour: "numeric",
      hour12: false,
    }),
  );
}

function getCentralDate(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

function getMondayOfWeek(): string {
  const now = new Date();
  const central = new Date(now.toLocaleString("en-US", { timeZone: "America/Chicago" }));
  const day = central.getDay();
  const offset = day === 0 ? 6 : day - 1;
  central.setDate(central.getDate() - offset);
  return central.toISOString().slice(0, 10);
}

function isWeekday(): boolean {
  const day = new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/Chicago" }),
  ).getDay();
  return day >= 1 && day <= 5;
}

export function useActionCenter(overrideDate?: string) {
  const [recommendations, setRecommendations] = useState<AgentRecommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const isLive = !overrideDate || overrideDate === getCentralDate();
  const currentHour = getCentralHour();
  const isBusinessHrs =
    isLive && currentHour >= BUSINESS_HOURS.START && currentHour <= BUSINESS_HOURS.END && isWeekday();

  const fetchData = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    setLoading(true);

    try {
      const todayStr = overrideDate ?? getCentralDate();
      const mondayStr = getMondayOfWeek();

      const [
        { data: roster },
        { data: weeklyData },
        { data: intradayData },
        { data: pipelineData },
        { data: poolData },
      ] = await Promise.all([
        supabase
          .from("agents")
          .select("name, site, tier, manager")
          .eq("is_active", true),
        supabase
          .from("daily_scrape_data")
          .select(
            "agent_name, scrape_date, ib_leads_delivered, ob_leads_delivered, ib_sales, ob_sales, custom_sales",
          )
          .gte("scrape_date", mondayStr)
          .lte("scrape_date", todayStr)
          .order("scrape_date", { ascending: true }),
        supabase
          .from("intraday_snapshots")
          .select(
            "agent_name, total_dials, talk_time_minutes, ib_leads_delivered, ib_sales, ob_leads_delivered, ob_sales, ib_premium, ob_premium, custom_premium, pool_dials, pool_talk_minutes, pool_self_assigned, pool_answered, pool_long_calls",
          )
          .eq("scrape_date", todayStr)
          .order("scrape_hour", { ascending: false }),
        supabase
          .from("pipeline_compliance_daily")
          .select(
            "agent_name, past_due_follow_ups, new_leads, call_queue_count, todays_follow_ups",
          )
          .eq("scrape_date", todayStr),
        supabase
          .from("leads_pool_daily_data")
          .select(
            "agent_name, calls_made, talk_time_minutes, self_assigned_leads, answered_calls, long_calls, sales_made",
          )
          .eq("scrape_date", todayStr),
      ]);

      if (!roster || roster.length === 0) {
        setRecommendations([]);
        return;
      }

      const rosterMap = new Map<string, { name: string; site: string; tier: Tier; manager: string | null }>();
      for (const a of roster) {
        rosterMap.set(a.name, {
          name: a.name,
          site: a.site,
          tier: a.tier as Tier,
          manager: a.manager ?? null,
        });
      }

      // Build weekly stats per agent
      const weeklyByAgent = new Map<string, WeeklyAgentStats["dailyRows"]>();
      for (const r of weeklyData ?? []) {
        if (!rosterMap.has(r.agent_name)) continue;
        const rows = weeklyByAgent.get(r.agent_name) ?? [];
        rows.push({
          date: r.scrape_date,
          ibLeads: r.ib_leads_delivered ?? 0,
          obLeads: r.ob_leads_delivered ?? 0,
          ibSales: r.ib_sales ?? 0,
          obSales: r.ob_sales ?? 0,
          customSales: r.custom_sales ?? 0,
        });
        weeklyByAgent.set(r.agent_name, rows);
      }

      const weeklyStats: WeeklyAgentStats[] = [];
      for (const [name, agent] of rosterMap) {
        weeklyStats.push({
          name,
          tier: agent.tier,
          site: agent.site,
          manager: agent.manager,
          dailyRows: weeklyByAgent.get(name) ?? [],
        });
      }

      // Build intraday map (latest snapshot per agent)
      const intradayMap = new Map<string, IntradaySnapshot>();
      for (const r of intradayData ?? []) {
        if (!intradayMap.has(r.agent_name) && rosterMap.has(r.agent_name)) {
          intradayMap.set(r.agent_name, {
            agentName: r.agent_name,
            totalDials: r.total_dials ?? 0,
            talkTimeMin: r.talk_time_minutes ?? 0,
            ibLeadsDelivered: r.ib_leads_delivered ?? 0,
            ibSales: r.ib_sales ?? 0,
            obLeads: r.ob_leads_delivered ?? 0,
            obSales: r.ob_sales ?? 0,
            totalPremium:
              (r.ib_premium ?? 0) + (r.ob_premium ?? 0) + (r.custom_premium ?? 0),
          });
        }
      }

      // Build pipeline map
      const pipelineMap = new Map<string, PipelineSnapshot>();
      for (const r of pipelineData ?? []) {
        if (rosterMap.has(r.agent_name)) {
          pipelineMap.set(r.agent_name, {
            agentName: r.agent_name,
            pastDue: r.past_due_follow_ups ?? 0,
            newLeads: r.new_leads ?? 0,
            callQueue: r.call_queue_count ?? 0,
            todaysFollowUps: r.todays_follow_ups ?? 0,
          });
        }
      }

      // Build pool map
      const poolMap = new Map<string, PoolSnapshot>();
      for (const r of poolData ?? []) {
        if (rosterMap.has(r.agent_name)) {
          poolMap.set(r.agent_name, {
            agentName: r.agent_name,
            poolDials: r.calls_made ?? 0,
            poolTalkMin: r.talk_time_minutes ?? 0,
            poolSelfAssigned: r.self_assigned_leads ?? 0,
            poolAnswered: r.answered_calls ?? 0,
            poolLongCalls: r.long_calls ?? 0,
            poolSales: r.sales_made ?? 0,
          });
        }
      }

      const marketing = await fetchMarketingSummary(supabase, todayStr);
      const recs = computeRecommendations(
        weeklyStats,
        pipelineMap,
        intradayMap,
        poolMap,
        true,
        marketing && marketing.cpc > 0 ? { leadCost: marketing.cpc } : undefined,
      );
      setRecommendations(recs);
      setLastRefresh(new Date());
    } catch {
      // Keep existing state on error
    } finally {
      setLoading(false);
    }
  }, [overrideDate, isLive]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-refresh 5 minutes after each hour (aligns with scrape schedule)
  useEffect(() => {
    if (!isLive) return;
    const now = new Date();
    const msUntilNextHour = (60 - now.getMinutes()) * 60 * 1000 - now.getSeconds() * 1000;
    const delay = msUntilNextHour + 5 * 60_000;
    const timeout = setTimeout(() => {
      fetchData();
      const interval = setInterval(fetchData, 60 * 60 * 1000);
      return () => clearInterval(interval);
    }, delay);
    return () => clearTimeout(timeout);
  }, [fetchData, isLive]);

  const summary = useMemo<ActionCenterSummary>(
    () => ({
      totalAgents: recommendations.length,
      critical: recommendations.filter((r) => r.severity === "critical").length,
      warning: recommendations.filter((r) => r.severity === "warning").length,
      onTrack: recommendations.filter((r) => r.severity === "info").length,
      currentHour: getCentralHour(),
      isBusinessHours: isBusinessHrs,
      scrapeDate: overrideDate ?? getCentralDate(),
    }),
    [recommendations, isBusinessHrs, overrideDate],
  );

  const criticalAgents = useMemo(
    () => recommendations.filter((r) => r.severity === "critical"),
    [recommendations],
  );
  const warningAgents = useMemo(
    () => recommendations.filter((r) => r.severity === "warning"),
    [recommendations],
  );
  const onTrackAgents = useMemo(
    () => recommendations.filter((r) => r.severity === "info"),
    [recommendations],
  );

  return {
    recommendations,
    criticalAgents,
    warningAgents,
    onTrackAgents,
    summary,
    loading,
    lastRefresh,
    refresh: fetchData,
  };
}
