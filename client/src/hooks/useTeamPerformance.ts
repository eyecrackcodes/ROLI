import { useState, useEffect, useCallback } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { calcROLI, calcLeadCost, type Tier } from "@/lib/types";

export interface TeamAgentStats {
  name: string;
  tier: Tier;
  site: string;
  totalSales: number;
  totalPremium: number;
  totalLeads: number;
  leadCost: number;
  profit: number;
  roli: number;
  closeRate: number;
  daysActive: number;
  ibSales: number;
  obSales: number;
  ibLeads: number;
  obLeads: number;
  avgDailySales: number;
  // Pipeline
  healthScore: number | null;
  pastDue: number;
  totalStale: number;
  revenueAtRisk: number;
  followUpCompliance: number;
}

export interface TeamSummary {
  manager: string;
  agentCount: number;
  agents: TeamAgentStats[];
  totalSales: number;
  totalPremium: number;
  totalLeadCost: number;
  totalProfit: number;
  teamROLI: number;
  avgAgentROLI: number;
  avgCloseRate: number;
  topPerformer: string;
  bottomPerformer: string;
  rank: number;
  // Pipeline
  avgHealthScore: number;
  totalRevenueAtRisk: number;
  totalStale: number;
  avgFollowUpCompliance: number;
  totalPastDue: number;
  pipelineAgentCount: number;
}

interface UseTeamPerformanceReturn {
  teams: TeamSummary[];
  loading: boolean;
  windowName: string;
  startDate: string;
  endDate: string;
}

export function useTeamPerformance(): UseTeamPerformanceReturn {
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [windowName, setWindowName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const fetchTeamData = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    setLoading(true);

    try {
      const { data: windowData } = await supabase
        .from("evaluation_windows")
        .select("*")
        .eq("is_active", true)
        .single();

      if (!windowData) {
        setLoading(false);
        return;
      }

      setWindowName(windowData.name);
      setStartDate(windowData.start_date);
      setEndDate(windowData.end_date);

      const latestPipelineDate = await supabase
        .from("pipeline_compliance_daily")
        .select("scrape_date")
        .order("scrape_date", { ascending: false })
        .limit(1)
        .single();

      const pipelineDate = latestPipelineDate.data?.scrape_date ?? null;

      const [{ data: prodRows }, { data: agentRows }, { data: pipelineRows }] = await Promise.all([
        supabase
          .from("daily_scrape_data")
          .select("agent_name, tier, ib_leads_delivered, ob_leads_delivered, ib_sales, ob_sales, custom_sales, ib_premium, ob_premium, custom_premium, scrape_date")
          .gte("scrape_date", windowData.start_date)
          .lte("scrape_date", windowData.end_date),
        supabase
          .from("agents")
          .select("name, tier, site, manager, is_active, terminated_date"),
        pipelineDate
          ? supabase
              .from("pipeline_compliance_daily")
              .select("agent_name, past_due_follow_ups, new_leads, call_queue_count, todays_follow_ups, post_sale_leads")
              .eq("scrape_date", pipelineDate)
          : Promise.resolve({ data: null }),
      ]);

      if (!prodRows || !agentRows) {
        setLoading(false);
        return;
      }

      // Pipeline lookup: agent_name -> raw pipeline numbers
      const pipelineLookup = new Map<string, {
        pastDue: number; newLeads: number; callQueue: number;
        todaysFollowUps: number; postSale: number;
      }>();
      if (pipelineRows) {
        for (const r of pipelineRows) {
          pipelineLookup.set(r.agent_name, {
            pastDue: r.past_due_follow_ups ?? 0,
            newLeads: r.new_leads ?? 0,
            callQueue: r.call_queue_count ?? 0,
            todaysFollowUps: r.todays_follow_ups ?? 0,
            postSale: r.post_sale_leads ?? 0,
          });
        }
      }

      const agentMeta = new Map<string, { tier: Tier; site: string; manager: string | null }>();
      for (const a of agentRows) {
        agentMeta.set(a.name, {
          tier: a.tier as Tier,
          site: a.site,
          manager: a.manager,
        });
      }

      const agentAgg = new Map<string, {
        tier: Tier; site: string; manager: string | null;
        ibSales: number; obSales: number; customSales: number;
        ibPremium: number; obPremium: number; customPremium: number;
        ibLeads: number; obLeads: number;
        dates: Set<string>;
      }>();

      for (const r of prodRows) {
        const meta = agentMeta.get(r.agent_name);
        if (!meta?.manager) continue;

        const existing = agentAgg.get(r.agent_name) ?? {
          tier: meta.tier, site: meta.site, manager: meta.manager,
          ibSales: 0, obSales: 0, customSales: 0,
          ibPremium: 0, obPremium: 0, customPremium: 0,
          ibLeads: 0, obLeads: 0,
          dates: new Set<string>(),
        };

        existing.ibSales += r.ib_sales ?? 0;
        existing.obSales += r.ob_sales ?? 0;
        existing.customSales += r.custom_sales ?? 0;
        existing.ibPremium += r.ib_premium ?? 0;
        existing.obPremium += r.ob_premium ?? 0;
        existing.customPremium += r.custom_premium ?? 0;
        existing.ibLeads += r.ib_leads_delivered ?? 0;
        existing.obLeads += r.ob_leads_delivered ?? 0;
        existing.dates.add(r.scrape_date);
        agentAgg.set(r.agent_name, existing);
      }

      const managerMap = new Map<string, TeamAgentStats[]>();

      for (const [name, agg] of Array.from(agentAgg)) {
        const totalSales = agg.ibSales + agg.obSales + agg.customSales;
        const totalPremium = agg.ibPremium + agg.obPremium + agg.customPremium;
        const totalLeads = agg.ibLeads + agg.obLeads;
        const leadCost = calcLeadCost(agg.tier, agg.ibLeads, agg.obLeads);
        const profit = totalPremium - leadCost;
        const roli = calcROLI(totalPremium, leadCost);
        const closeRate = totalLeads > 0 ? (totalSales / totalLeads) * 100 : 0;
        const daysActive = agg.dates.size;

        // Pipeline metrics for this agent
        const pl = pipelineLookup.get(name);
        const pastDue = pl?.pastDue ?? 0;
        const newLeadsP = pl?.newLeads ?? 0;
        const callQueue = pl?.callQueue ?? 0;
        const todaysFollowUps = pl?.todaysFollowUps ?? 0;
        const postSale = pl?.postSale ?? 0;
        const totalStale = newLeadsP + callQueue + pastDue;
        const fuTotal = pastDue + todaysFollowUps;
        const followUpCompliance = fuTotal > 0 ? (1 - pastDue / fuTotal) * 100 : 100;

        // Simplified health score (follow-up discipline + pipeline freshness, 0–50 scaled to 0–100)
        let healthScore: number | null = null;
        if (pl) {
          const fuDiscipline = fuTotal === 0 ? 25 : Math.max(0, 25 * (1 - pastDue / fuTotal));
          const freshTotal = newLeadsP + callQueue + pastDue;
          const freshness = freshTotal === 0 ? 25 : Math.max(0, 25 * (1 - totalStale / (freshTotal + postSale + todaysFollowUps + 1)));
          healthScore = Math.round(((fuDiscipline + freshness) / 50) * 100);
        }

        const agentStats: TeamAgentStats = {
          name, tier: agg.tier, site: agg.site,
          totalSales, totalPremium, totalLeads, leadCost, profit, roli,
          closeRate, daysActive,
          ibSales: agg.ibSales, obSales: agg.obSales,
          ibLeads: agg.ibLeads, obLeads: agg.obLeads,
          avgDailySales: daysActive > 0 ? totalSales / daysActive : 0,
          healthScore, pastDue, totalStale, revenueAtRisk: 0,
          followUpCompliance,
        };

        const mgr = agg.manager!;
        const list = managerMap.get(mgr) ?? [];
        list.push(agentStats);
        managerMap.set(mgr, list);
      }

      const teamSummaries: TeamSummary[] = [];

      for (const [manager, agents] of Array.from(managerMap)) {
        const sorted = [...agents].sort((a, b) => b.roli - a.roli);
        const totalSales = agents.reduce((s, a) => s + a.totalSales, 0);
        const totalPremium = agents.reduce((s, a) => s + a.totalPremium, 0);
        const totalLeadCost = agents.reduce((s, a) => s + a.leadCost, 0);
        const totalProfit = agents.reduce((s, a) => s + a.profit, 0);
        const teamROLI = totalLeadCost > 0 ? (totalProfit / totalLeadCost) : 0;
        const avgAgentROLI = agents.length > 0 ? agents.reduce((s, a) => s + a.roli, 0) / agents.length : 0;
        const avgCloseRate = agents.length > 0 ? agents.reduce((s, a) => s + a.closeRate, 0) / agents.length : 0;

        const pipelineAgents = agents.filter((a) => a.healthScore !== null);
        const pipelineAgentCount = pipelineAgents.length;
        const avgHealthScore = pipelineAgentCount > 0
          ? pipelineAgents.reduce((s, a) => s + (a.healthScore ?? 0), 0) / pipelineAgentCount
          : 0;
        const totalRevenueAtRisk = agents.reduce((s, a) => s + a.revenueAtRisk, 0);
        const teamTotalStale = agents.reduce((s, a) => s + a.totalStale, 0);
        const avgFollowUpCompliance = pipelineAgentCount > 0
          ? pipelineAgents.reduce((s, a) => s + a.followUpCompliance, 0) / pipelineAgentCount
          : 0;
        const teamTotalPastDue = agents.reduce((s, a) => s + a.pastDue, 0);

        teamSummaries.push({
          manager,
          agentCount: agents.length,
          agents: sorted,
          totalSales,
          totalPremium,
          totalLeadCost,
          totalProfit,
          teamROLI,
          avgAgentROLI,
          avgCloseRate,
          topPerformer: sorted[0]?.name ?? "—",
          bottomPerformer: sorted[sorted.length - 1]?.name ?? "—",
          rank: 0,
          avgHealthScore,
          totalRevenueAtRisk,
          totalStale: teamTotalStale,
          avgFollowUpCompliance,
          totalPastDue: teamTotalPastDue,
          pipelineAgentCount,
        });
      }

      teamSummaries.sort((a, b) => b.teamROLI - a.teamROLI);
      teamSummaries.forEach((t, i) => { t.rank = i + 1; });

      setTeams(teamSummaries);
    } catch {
      // keep existing
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTeamData();
  }, [fetchTeamData]);

  return { teams, loading, windowName, startDate, endDate };
}
