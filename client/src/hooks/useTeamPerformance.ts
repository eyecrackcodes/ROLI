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

      const [{ data: prodRows }, { data: agentRows }] = await Promise.all([
        supabase
          .from("daily_scrape_data")
          .select("agent_name, tier, ib_leads_delivered, ob_leads_delivered, ib_sales, ob_sales, custom_sales, ib_premium, ob_premium, custom_premium, scrape_date")
          .gte("scrape_date", windowData.start_date)
          .lte("scrape_date", windowData.end_date),
        supabase
          .from("agents")
          .select("name, tier, site, manager, is_active, terminated_date"),
      ]);

      if (!prodRows || !agentRows) {
        setLoading(false);
        return;
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

        const agentStats: TeamAgentStats = {
          name, tier: agg.tier, site: agg.site,
          totalSales, totalPremium, totalLeads, leadCost, profit, roli,
          closeRate, daysActive,
          ibSales: agg.ibSales, obSales: agg.obSales,
          ibLeads: agg.ibLeads, obLeads: agg.obLeads,
          avgDailySales: daysActive > 0 ? totalSales / daysActive : 0,
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
